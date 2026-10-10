# Coverage baseline

Recorded 2026-10-09 on Node v26.10.0 with `npm run test:coverage` in each package (`backend`: Vitest + v8, `frontend`: Vitest + jsdom + v8). Figures are taken from `<pkg>/coverage/coverage-summary.json`.

Existing suites before any changes: backend 4 files / 48 tests passed; frontend 14 files / 18 tests passed.

## Package totals

| Package  | Lines  | Branches | Functions | Statements |
|----------|--------|----------|-----------|------------|
| backend  | 33.02 % (36/109)  | 33.33 % (16/48) | 40.62 % (13/32) | 30.23 % (39/129) |
| frontend | 47.68 % (72/151)  | 43.79 % (60/137) | 40.25 % (31/77) | 46.42 % (78/168) |

## After (Task 13 coverage push)

Recorded 2026-10-09 after the agentic-tests run (`npm run agentic-tests -- --all`, run 2, status `tests-ready`) and the manual review listed in `docs/coverage-push-report.md`. Suites: backend 9 files / 89 tests passed, frontend 23 files / 83 tests passed.

| Package  | Lines (before → after) | Branches (before → after) | Functions (after) | Statements (after) |
|----------|------------------------|---------------------------|-------------------|--------------------|
| backend  | 33.02 % → **100 %** (106/106) | 33.33 % → **97.91 %** (47/48) | 96.77 % (30/31) | 98.41 % (124/126) |
| frontend | 47.68 % → **93.37 %** (141/151) | 43.79 % → **93.43 %** (128/137) | 89.61 % (69/77) | 93.45 % (157/168) |

The backend "after" figures exclude `src/main.ts` (process bootstrap, now in the coverage `exclude` list), so the denominator dropped from 109 to 106 lines. Coverage measured by the pipeline just before the push was backend 37.61 % lines (Task 10 had added `health.test.ts`) and frontend 47.68 %.

Files still below 90 % lines or 80 % branches after the push:

| File | Lines | Branches |
|------|-------|----------|
| `frontend/src/features/todos/TodosPage.tsx` | 69.23 | 83.33 |
| `frontend/src/features/todos/components/TodoForm.tsx` | 87.5 | 81.81 |

### Enforced thresholds

- Frontend (`frontend/vite.config.ts`): package-wide `thresholds: { lines: 90, branches: 80 }`.
- Backend (`backend/vitest.config.ts`): `perFile: true` with `lines: 80, branches: 70` for every file (`src/main.ts` excluded), plus the existing 100 % block for `validators.ts`/`mappers.ts`. Every backend file meets the per-file bar (the lowest is `factory.ts` at 100 % lines / 92.85 % branches), so it did not need lowering.

## Backend files below 90 % lines or 80 % branches

| File | Lines | Branches |
|------|-------|----------|
| `backend/src/factory.ts` | 0 | 0 |
| `backend/src/main.ts` | 0 | 100 |
| `backend/src/api/health.ts` | 0 | 100 |
| `backend/src/core/config.ts` | 0 | 0 |
| `backend/src/core/database.ts` | 66.66 | 100 |
| `backend/src/core/lifespan.ts` | 0 | 0 |
| `backend/src/features/todos/router.ts` | 44 | 16.66 |

Backend files at 100 % lines and branches: `features/todos/mappers.ts`, `features/todos/repository.ts`, `features/todos/validators.ts`.

## Frontend files below 90 % lines or 80 % branches

| File | Lines | Branches |
|------|-------|----------|
| `frontend/src/app/AppProviders.tsx` | 0 | 0 |
| `frontend/src/features/todos/TodosPage.tsx` | 50 | 61.11 |
| `frontend/src/features/todos/api/todos.ts` | 57.14 | 100 |
| `frontend/src/features/todos/components/DeleteTodoDialog.tsx` | 37.5 | 62.5 |
| `frontend/src/features/todos/components/TodoEditor.tsx` | 90 | 62.5 |
| `frontend/src/features/todos/components/TodoEmptyState.tsx` | 0 | 0 |
| `frontend/src/features/todos/components/TodoForm.tsx` | 87.5 | 63.63 |
| `frontend/src/features/todos/components/TodoItem.tsx` | 100 | 35.71 |
| `frontend/src/features/todos/components/TodoList.tsx` | 20 | 62.5 |
| `frontend/src/features/todos/hooks/useCreateTodoMutation.ts` | 0 | 0 |
| `frontend/src/features/todos/hooks/useDeleteTodoMutation.ts` | 0 | 100 |
| `frontend/src/features/todos/hooks/useTodoFilters.ts` | 0 | 100 |
| `frontend/src/features/todos/hooks/useTodosBusy.ts` | 0 | 100 |
| `frontend/src/features/todos/hooks/useTodosQuery.ts` | 0 | 100 |
| `frontend/src/features/todos/hooks/useUpdateTodoMutation.ts` | 0 | 0 |
| `frontend/src/features/todos/utils/todos.ts` | 52 | 33.33 |
| `frontend/src/hooks/useNotice.ts` | 71.42 | 75 |
| `frontend/src/lib/http.ts` | 0 | 0 |

`TodoEditor.tsx` is listed because its branch coverage is below 80 %; its line coverage (90 %) is not below the 90 % threshold.

## Notes

- Backend `vitest.config.ts` sets per-file 100 % thresholds for `src/features/todos/{validators,mappers}.ts`; both currently meet them.
- Frontend `vite.config.ts` set no coverage thresholds at baseline (see "Enforced thresholds" above for the current values).
- `coverage/` is git-ignored.
