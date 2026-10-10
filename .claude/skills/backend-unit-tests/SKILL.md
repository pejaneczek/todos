---
name: backend-unit-tests
description: Conventions and patterns for Taskly backend unit tests (Express + Prisma + zod, Vitest + Supertest, no database). Use when creating or updating tests under backend/tests.
---

# Backend unit tests (Taskly)

- Location: `backend/tests/<module-basename>.test.ts` (for example, `src/core/config.ts` → `tests/config.test.ts`).
- Imports use explicit `.ts` extensions: `import { createTodosRouter } from '../src/features/todos/router.ts';`
- Import `it`, `expect`, `vi`, `afterEach` from `vitest`. Tests are top-level `it(...)` blocks. Don't add a `describe` unless the file already has one.
- Shared data: `record` (Prisma row) and `todo` (API JSON) from `tests/fixture.ts`. Extend that file rather than duplicating literals.
- No PostgreSQL, ever. Mock at the module boundary.

## Router pattern (Supertest + fake repository)
```ts
function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
```
Assert the status code, the body, and the exact repository arguments. For invalid input, assert 422 and `expect(repository.x).not.toHaveBeenCalled()`. Use `it.each` tables for validation cases.

## Repository pattern (real Prisma client, mocked IO)
```ts
afterEach(() => vi.restoreAllMocks());
function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, repository: new TodoRepository(database) };
}
const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
```
Assert the exact Prisma arguments (`where`, `orderBy`, `data`) and the mapped result.

## Validators and mappers
`it.each` tables covering every branch. `vitest.config.ts` enforces 100 % per-file coverage for `validators.ts` and `mappers.ts`, so any new branch there needs a case.

## Core, app factory, health
- `core/config.ts`: `vi.stubEnv(...)` per case and `vi.unstubAllEnvs()` in `afterEach`. Cover the explicit URL, the `postgresql+psycopg:` rewrite, each missing variable, and encoding of the database name.
- `factory.ts` / `api/health.ts`: Supertest against `createApp(fakeDatabase)` or `createHealthRouter(fakeDatabase)`, with `fakeDatabase = { todo: { findFirst: vi.fn() } } as never` (add only the delegates used). Cover 404 JSON, invalid JSON → 422, body too large → 413, an unexpected error → 500 (spy on `console.error` and silence it), and `/openapi.json`.
- `core/lifespan.ts`: mock `./database.js`, `./config.js`, and `../factory.js` with `vi.mock` (path relative to the test file: `'../src/core/database.ts'`). Assert the connect/initialize/listen order and that disconnect happens on failure. Don't bind real ports (mock `createApp` to return `{ listen: (port, host, cb) => { cb(); return fakeServer; } }`).
- `core/database.ts`: `initialize` calls `$executeRaw` once. Assert it was called with a template containing `CREATE TABLE IF NOT EXISTS todos`.
