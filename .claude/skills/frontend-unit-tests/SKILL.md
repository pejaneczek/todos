---
name: frontend-unit-tests
description: Conventions and patterns for Taskly frontend unit tests (React 19 + TanStack Query + styled-components design system; Vitest + React Testing Library + user-event, jsdom). Use when creating or updating frontend tests.
---

# Frontend unit tests (Taskly)

- Location: next to the source file. `X.tsx` → `X.test.tsx`, `x.ts` → `x.test.ts`. A `.ts` test cannot contain JSX, so use `createElement` for wrappers.
- Setup is automatic: `src/test/setup.ts` loads jest-dom matchers and runs `cleanup`. Test data: `todoFixture` from `src/test/todoFixture.ts`. Spread it for variants: `{ ...todoFixture, completed: true }`.
- Style: Prettier (no semicolons, single quotes). The pipeline formats files after you write them.
- Query by role or label (`getByRole('button', { name: 'New task' })`). Never by class or test id.
- Interactions: `const user = userEvent.setup()`, then `await user.click(...)`.

## Components
```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
```
(adjust the relative path). Mock child components and hooks the way `features/todos/TodosPage.test.tsx` does: `vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))`, then `vi.mocked(useTodosQuery).mockReturnValue({...} as never)`.

## Hooks using TanStack Query
```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}
```
Assert observable cache effects: `client.getQueryData(todoKeys.list)` after `result.current.mutateAsync(...)`, ordering and de-duplication, `cancelQueries`/`invalidateQueries` (spy on the client), and `mutationKey` (useTodosBusy relies on it).

## `lib/http.ts`
`vi.stubGlobal('fetch', vi.fn())` with `afterEach(() => vi.unstubAllGlobals())`. Cover: success JSON; 204 returns `undefined`; 422 → the validation message; other errors with a string `detail` → that detail; a non-JSON error body → the generic message; a network error → "Cannot connect…"; an aborted signal rethrows the original error; the `Content-Type` header is merged with caller headers.

## Don't
- Don't test files excluded from coverage (`design-system/**`, `index.ts`, `types.ts`, `queryKeys.ts`, `queryClient.ts`, `main.tsx`).
- Don't use snapshots or real timers for debounce (use `vi.useFakeTimers()` with `shouldAdvanceTime: true` and `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`).
