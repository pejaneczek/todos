---
name: qa-test
description: QA step. Verify a Taskly task's acceptance criteria against the implementation, by mapping each AC to tests and running them, optionally with end-to-end API checks via docker compose; produces a pass/fail matrix.
argument-hint: "<#issue | tasks/TASK-NNN-slug.md> [--e2e] [--post]"
disable-model-invocation: true
---

Input: `$ARGUMENTS`, the task reference plus optional `--e2e` and `--post`.

1. Load the task's acceptance criteria (see dev-implement step 1). Find the implementation: `gh pr list --state all --search "Closes #<n> in:body" --json number,headRefName,body`, and keep only PRs whose body contains exactly `Closes #<n>` (word boundary, so `#1` does not match `#12`). Or use the current branch. Before `gh pr checkout <n>`, require a clean tree (same rule as dev-implement step 2) and confirm with the user. Note: unit tests and `docker compose up --build` execute the PR's code locally, so only QA same-repo PRs you trust.
2. For each criterion, find covering unit tests: search test names and assertions (Grep) for the endpoint, field, UI text, or hook named in the criterion. Run them (`npm --prefix <pkg> test -- <files>`).
3. With `--e2e`: if `.env` is missing, ask before running `cp .env.example .env`. Read the port with `grep -E '^API_PORT=' .env | cut -d= -f2` (default 8000). Before `docker compose up --build -d --wait`, check `docker compose ps --quiet`: if containers were already running, do NOT run `docker compose down` at the end; tell the user instead. Otherwise always run `docker compose down` at the end, even on failure. Exercise each API criterion with `curl -s -w '\n%{http_code}' "http://localhost:$PORT/api/..."`, creating the data it needs through the API first.
4. Output the matrix:

| AC | Status | Evidence |
|---|---|---|
| AC-1 | ✅ pass / ❌ fail / ⚠️ not covered | test names, curl status and body excerpt, failure output |

   Then list the gaps and the tests you would add. QA does not edit code or tests: hand gaps back via `/dev-implement` or `/agentic-tests`.
5. Save the result to `tasks/TASK-NNN-<slug>.qa.md`. With `--post`, confirm, then write the comment to a temp file outside the repo (`BODY="$(mktemp -d)/qa-comment.md"`) and run `gh issue comment <n> --body-file "$BODY"` (or `gh pr comment`).
