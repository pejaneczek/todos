<!-- agentic-tests -->
## 🧪 Agentic unit tests: ✅ Tests written and verified (uncommitted)

### Verification (pipeline)

| Package | Passed | Failed | Lines | Branches |
|---|---|---|---|---|
| backend | 85 | 0 | 37.6% → 92.7% | 33.3% → 97.9% |
| frontend | 78 | 0 | 47.7% → 93.4% | 43.8% → 93.4% |


### Decisions

| Source | Decision | Test file | Cases (+/~, agent-reported) | Reason |
|---|---|---|---|---|
| `backend/src/core/config.ts` | create | `backend/tests/config.test.ts` | 9/0 | No test existed; covers override, psycopg rewrite, composed URL, name encoding and each missing variable. |
| `backend/src/core/database.ts` | create | `backend/tests/database.test.ts` | 3/0 | No test existed; covers client creation and the CREATE TABLE initialization and its failure. |
| `backend/src/core/lifespan.ts` | create | `backend/tests/lifespan.test.ts` | 4/0 | No test existed; covers startup order, port selection and disconnect on failure. |
| `backend/src/factory.ts` | create | `backend/tests/factory.test.ts` | 7/0 | No test existed; covers 404, 422, 413, 500 handlers, todos routing and openapi.json. |
| `backend/src/features/todos/router.ts` | update | `backend/tests/router.test.ts` | 11/0 | Existing test covered only list and create; added get, update, delete, 404 and id validation cases. |
| `frontend/src/app/AppProviders.tsx` | create | `frontend/src/app/AppProviders.test.tsx` | 2/0 | No test existed; covers default and custom query client and global styles rendering. |
| `frontend/src/features/todos/TodosPage.tsx` | update | `frontend/src/features/todos/TodosPage.test.tsx` | 4/1 | Existing test covered only retry; added toggle success, busy guard and toggle failure cases. |
| `frontend/src/features/todos/api/todos.ts` | update | `frontend/src/features/todos/api/todos.test.ts` | 2/0 | Existing tests covered list and create; added update and remove cases. |
| `frontend/src/features/todos/components/DeleteTodoDialog.tsx` | update | `frontend/src/features/todos/components/DeleteTodoDialog.test.tsx` | 3/0 | Existing test only covered the error/cancel path; added success, failure and busy cases. |
| `frontend/src/features/todos/components/TodoEditor.tsx` | update | `frontend/src/features/todos/components/TodoEditor.test.tsx` | 2/0 | Existing test only covered create; added update, failed save and busy-guard cases. |
| `frontend/src/features/todos/components/TodoEmptyState.tsx` | create | `frontend/src/features/todos/components/TodoEmptyState.test.tsx` | 3/0 | No test existed; covers first-task, disabled and no-match variants. |
| `frontend/src/features/todos/components/TodoForm.tsx` | update | `frontend/src/features/todos/components/TodoForm.test.tsx` | 2/0 | Added initial values/error/busy and cancel cases missing from the existing test. |
| `frontend/src/features/todos/components/TodoItem.tsx` | update | `frontend/src/features/todos/components/TodoItem.test.tsx` | 4/0 | Added completed, toggle/delete, overdue and busy cases missing from the existing test. |
| `frontend/src/features/todos/components/TodoList.tsx` | update | `frontend/src/features/todos/components/TodoList.test.tsx` | 3/0 | Added failed-load, cached-list and toggle/delete forwarding cases; extended the TodoItem mock. |
| `frontend/src/features/todos/hooks/useCreateTodoMutation.ts` | create | `frontend/src/features/todos/hooks/useCreateTodoMutation.test.ts` | 4/0 | No test existed; covers cache prepend, de-duplication, empty cache and failure. |
| `frontend/src/features/todos/hooks/useDeleteTodoMutation.ts` | create | `frontend/src/features/todos/hooks/useDeleteTodoMutation.test.ts` | 3/0 | No test existed; covers cache removal, empty cache and failure. |
| `frontend/src/features/todos/hooks/useTodoFilters.ts` | create | `frontend/src/features/todos/hooks/useTodoFilters.test.ts` | 2/0 | No test existed; covers default state and filter/search/sort updates feeding visible todos. |
| `frontend/src/features/todos/hooks/useTodosBusy.ts` | create | `frontend/src/features/todos/hooks/useTodosBusy.test.ts` | 2/0 | No test existed; covers busy state for todos mutations and ignoring unrelated keys. |
| `frontend/src/features/todos/hooks/useTodosQuery.ts` | create | `frontend/src/features/todos/hooks/useTodosQuery.test.ts` | 2/0 | No test existed; covers success with abort signal, cache key and error exposure. |
| `frontend/src/features/todos/hooks/useUpdateTodoMutation.ts` | create | `frontend/src/features/todos/hooks/useUpdateTodoMutation.test.ts` | 3/0 | No test existed; covers cache replacement, cancelQueries, missing cache and failure paths. |
| `frontend/src/features/todos/utils/todos.ts` | update | `frontend/src/features/todos/utils/todos.test.ts` | 10/0 | Existing test covered only two selectTodos cases; added validateTodo, sorting, isOverdue, formatDate and labels. |
| `frontend/src/hooks/useNotice.ts` | update | `frontend/src/hooks/useNotice.test.ts` | 2/0 | Existing test only checked initial state; added 4-second auto-dismiss and timer restart cases with fake timers. |
| `frontend/src/lib/http.ts` | create | `frontend/src/lib/http.test.ts` | 7/0 | No test existed; covers success, 204, 422, detail, generic error, network error and abort paths. |

### Findings

- **note** `frontend/src/features/todos/TodosPage.test.tsx`: The TodoList mock was changed to a toggle button so toggling can be tested; the existing retry case is unaffected. Coverage run was not performed.

<details><summary>Run details</summary>

- Mode: all
- Skills used: `analyze-pr-changes`, `backend-unit-tests`, `frontend-unit-tests`, `run-and-verify-tests`, `report-results`
- Agent turns: 118, cost: $0.85
- Skipped before the agent ran:
  - `backend/src/features/todos/types.ts`: type declarations only
  - `backend/src/main.ts`: process bootstrap
  - `frontend/src/App.test.tsx`: test file
  - `frontend/src/components/ApplicationHeader.test.tsx`: test file
  - `frontend/src/components/SuccessNotice.test.tsx`: test file
  - `frontend/src/design-system/components/Alert/Alert.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Alert/Alert.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Alert/Alert.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Alert/Alert.types.ts`: type declarations only
  - `frontend/src/design-system/components/Alert/index.ts`: re-export barrel
  - `frontend/src/design-system/components/AppHeader/AppHeader.stories.tsx`: storybook story
  - `frontend/src/design-system/components/AppHeader/AppHeader.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/AppHeader/AppHeader.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/AppHeader/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Badge/Badge.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Badge/Badge.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Badge/Badge.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Badge/Badge.types.ts`: type declarations only
  - `frontend/src/design-system/components/Badge/Badge.variants.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Badge/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Button/Button.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Button/Button.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Button/Button.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Button/Button.types.ts`: type declarations only
  - `frontend/src/design-system/components/Button/Button.variants.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Button/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Card/Card.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Card/Card.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Card/Card.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Card/Card.types.ts`: type declarations only
  - `frontend/src/design-system/components/Card/Card.variants.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Card/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Checkbox/Checkbox.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Checkbox/Checkbox.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Checkbox/Checkbox.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Checkbox/Checkbox.types.ts`: type declarations only
  - `frontend/src/design-system/components/Checkbox/index.ts`: re-export barrel
  - `frontend/src/design-system/components/CheckboxGroup/CheckboxGroup.stories.tsx`: storybook story
  - `frontend/src/design-system/components/CheckboxGroup/CheckboxGroup.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/CheckboxGroup/CheckboxGroup.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/CheckboxGroup/CheckboxGroup.types.ts`: type declarations only
  - `frontend/src/design-system/components/CheckboxGroup/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Drawer/Drawer.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Drawer/Drawer.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Drawer/Drawer.tsx`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Drawer/Drawer.types.ts`: type declarations only
  - `frontend/src/design-system/components/Drawer/index.ts`: re-export barrel
  - `frontend/src/design-system/components/Heading/Heading.stories.tsx`: storybook story
  - `frontend/src/design-system/components/Heading/Heading.styles.ts`: design system (excluded from coverage)
  - `frontend/src/design-system/components/Heading/Heading.tsx`: design system (excluded from coverage)

</details>
---

## Pipeline runs (2026-10-09)

Both runs used `npm run agentic-tests -- --all` with the unchanged `scripts/agentic-tests/agent-config.json` (model `claude-sonnet-5-5`, `maxTurns` 60, `batchSize` 8, $5 per batch, 20 min timeout). The coverage filter selected 23 targets (5 backend, 18 frontend), split into 3 batches.

| Run | Status | Batch 1 (turns / cost) | Batch 2 | Batch 3 | Total |
|-----|--------|------------------------|---------|---------|-------|
| 1 | `agent-failed` | 45 / $0.33, ok | 40 / $0.38, ok | 26 / $0.16, **agent wrote no report** | 111 turns, $0.87 |
| 2 | `tests-ready` | 44 / $0.29, ok | 41 / $0.30, ok | 33 / $0.26, ok | 118 turns, $0.85 |

- Run 1, batch 3 (`useTodoFilters`, `useTodosBusy`, `useTodosQuery`, `useUpdateTodoMutation`, `utils/todos`, `useNotice`, `lib/http`): every `Write`/`Edit` call was refused in `dontAsk` mode (7 permission denials), so the agent stopped without writing `.agentic-tests/agent-report.json`. The runner then discarded all of run 1's output, as designed. Batch 2 had written into the same `hooks/` directory under the same `Edit(...)` rules without any denial, so the refusal looked non-deterministic, and the config was left unchanged for run 2. Root cause (found in review): the allow rules were relative `Edit(frontend/src/**/*.test.ts)`, and relative rules resolve against the session's *current* directory, so they stop matching once the agent changes directory. Fixed after the push: `buildClaudeArgs` now anchors every relative `Edit(...)`/`Read(...)` rule to the repo root (`Edit(//<root>/…)`), and the test-writer agent's hard rules forbid `cd`.
- Run 2: one `Bash` heredoc append was denied in batch 3, and the agent fell back to `Edit`. 23 test files were accepted and none rejected. The pipeline's own verification passed: backend 85/85, frontend 78/78.
- No `it.fails` / `suspected_bug` findings, so no production bug was reported. The only finding was a `note` about the TodosPage `TodoList` mock.

## Manual review changes

Every generated test was reviewed against `.claude/skills/backend-unit-tests` and `.claude/skills/frontend-unit-tests`. No test used `.only`, `.skip`, `.todo`, snapshots or real network/DB access. The changes below were made by hand after run 2. Every other generated file was kept as the agent wrote it.

| File | Change | Why |
|------|--------|-----|
| `backend/tests/lifespan.test.ts` | Added assertions that the resolved URL reaches `createDatabase` and that `initialize`/`createApp` receive the database, and checked the "listening" log line. Added tests for: a listen `error` → disconnect + rethrow; SIGTERM/SIGINT → `server.close` first, then `$disconnect`; a disconnect failure on shutdown → `console.error` + `process.exitCode = 1` (reset in `afterEach`). Capture `process.once` handlers instead of stubbing them away. | The shutdown path (lines 19–23) was untested (75 % lines, below the new 80 % per-file bar), and the original happy-path test never checked what was passed between modules. |
| `backend/tests/factory.test.ts` | 500 case now asserts `console.error` was called with the thrown error. Todos route asserts `toEqual([todo])` via the fixture. `/openapi.json` also asserts `paths['/api/todos']`. Removed the unused `findFirst`, `create` and `$queryRaw` fake delegates. | `toHaveBeenCalled()` and a title-only check were weak. The skill says to add only the delegates that are used. |
| `backend/tests/database.test.ts` | The client test now checks `$connect`, `$executeRaw` and `todo.findMany` are functions, not just that `todo` is defined. (`instanceof PrismaClient` was tried and doesn't hold, because the Prisma constructor returns a proxied client.) | `toBeDefined()` alone said almost nothing. |
| `backend/tests/router.test.ts` | 404 case asserts that the repository received id 5 for get, update and delete. The PATCH success case asserts the full body (`{ ...todo, completed: true }`), not just `completed`. | Assert the exact repository arguments and the body, per the skill. |
| `frontend/src/features/todos/hooks/useCreateTodoMutation.test.ts`, `useUpdateTodoMutation.test.ts`, `useDeleteTodoMutation.test.ts` | Each asserts the mutation's `mutationKey` (`todoKeys.create` / `update` / `delete`). | The skill requires it, because `useTodosBusy` depends on these keys. |
| `frontend/src/features/todos/hooks/useTodosBusy.test.ts` | Rewritten: `it.each` over all three todo mutation keys. The "unrelated key" case now waits until `client.isMutating() === 1` and flushes React before asserting `false`. | The original negative assertion could pass before the hook had re-rendered, and only the `update` key was covered. |
| `frontend/src/features/todos/hooks/useTodoFilters.test.ts` | Default state asserts the order (`[done, todoFixture]`). New case checks that `setSort('due')` actually reorders `visible`. | The sort was only checked as state, never for its effect. |
| `frontend/src/features/todos/components/TodoEditor.test.tsx` | Split "does not report success or save while busy, nor when saving fails" into two tests ("does not report success when saving fails", "ignores submissions while busy") with a shared `mockMutations` helper. | One behavior per test. |
| `frontend/src/features/todos/components/TodoForm.test.tsx` | `getByTestId('alert')` → `getByText('Server said no')`. | The skill forbids test-id queries. |
| `frontend/src/features/todos/components/TodoItem.test.tsx` | Query the checkbox by accessible name (`Mark as active: …`). Overdue case asserts the full badge text `1 Jan 2020 · overdue`. Future-date case asserts `1 Jan 2999` is shown. | Regexes like `/overdue/` didn't check that the formatted date was rendered. |
| `frontend/src/features/todos/components/DeleteTodoDialog.test.tsx` | New case "shows Deleting… and keeps the button disabled while pending": while the mutation itself is pending (`isPending`, `busy={false}`), the button reads "Deleting…" and is disabled. (Review fix round 1: renamed from "ignores delete clicks…". A disabled button can't fire, so the test doesn't exercise the `if (pending) return` guard on line 19.) | Only the `busy` prop path was covered. |
| `frontend/src/features/todos/hooks/useTodosQuery.test.ts` | (Review fix round 1) The abort-signal check is now `toHaveBeenCalledWith(expect.any(AbortSignal))`, not a `mock.calls[0][0]` read, and `beforeEach(() => vi.clearAllMocks())` was added. | The old read depended on test order, because mock calls leaked between tests. |
| `frontend/src/features/todos/utils/todos.test.ts` | Added `completed: false` to the `validateTodo` input. | `npm --prefix frontend run typecheck` failed: `TodoInput` requires `completed`. (The agent's tool allowlist can't run typecheck.) |
| `frontend/src/features/todos/TodosPage.test.tsx` | `arrange()` types `notify` as `(message: string) => void`. | Same typecheck failure, on the `useNotice` mock. |
| `frontend/index.html` | (Review fix round 1) Prettier formatting only: the `<meta name="description">` tag is wrapped across lines. | It made `format:check` fail before Task 13. |
| `frontend/src/components/ApplicationHeader.test.tsx` | Prettier formatting only. Pre-existing, not agent output. | It made `format:check` fail before Task 13. |

Kept as written (reviewed, no change): `config.test.ts`, `AppProviders.test.tsx`, `TodoEmptyState.test.tsx`, `lib/http.test.ts`, `api/todos.test.ts`, `TodoList.test.tsx`, `useNotice.test.ts`.

## Coverage after review

| Package | Lines | Branches |
|---------|-------|----------|
| backend | 100 % (106/106) | 97.91 % (47/48) |
| frontend | 93.37 % (141/151) | 93.43 % (128/137) |

Known remaining gaps: `TodosPage.tsx` (69 % lines: the create, edit and delete handlers are hidden behind mocked children), `TodoForm.tsx` (87.5 %), `DeleteTodoDialog.tsx` line 19 (the `if (pending) return` guard can't be reached through a disabled button), and `factory.ts` line 20 (the `headersSent` branch).
