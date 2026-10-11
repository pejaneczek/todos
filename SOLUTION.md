# Solution: agentic unit-test pipeline for Taskly

## 1. Overview

A Claude Code custom agent (`test-writer`) with five reusable skills creates and updates unit tests for changed code. The same pipeline runs locally (`npm run agentic-tests -- --base origin/main`) and as a GitHub Actions workflow on every pull request. The agent supplies judgment (what needs a test, what to assert). Plain Node scripts supply every trust decision: which files may change, whether the tests really pass, what gets committed, and what the PR comment says.

```
PR opened / updated (same-repo, not draft, no `skip-agentic-tests` label)
  job agent    (contents: read; ANTHROPIC_API_KEY in one step only)
     run.js --stage agent
       classify changes -> coverage before -> snapshot tree
       -> claude -p --agent test-writer (skills), in batches of 8 files
       -> guard (restore anything that is not a test file) -> tests.patch + state.json
  job verify   (contents: read; no secrets)
     run.js --stage verify
       validate patch paths -> git apply -> prettier (frontend)
       -> vitest on the new files -> full suite + coverage (retry/reject loop)
       -> guard again -> hash accepted files -> publish bundle + report.json/md
  job publish  (contents: write, pull-requests: write; base-branch runner scripts; never runs npm or tests)
     run.js --stage publish
       validate bundle (status, test paths, sha256) -> commit via the GitHub git-data
       REST API (fast-forward only, expected-head check) -> sticky PR comment + job summary
  job fork-notice: fork PRs only get a step-summary note

Local: npm run agentic-tests -- --base origin/main | --pr N [--post] | --all    (same code, never commits)
```

Files: `scripts/agentic-tests/*.js` (runner), `.github/workflows/agentic-tests.yml`, `.claude/agents/test-writer.md`, `.claude/skills/*`, `.claude/settings.json`.

## 2. Key decisions and why

| Decision | Why |
|---|---|
| **Claude Code** (native agents and skills, headless `claude -p`) | One set of artifacts (`.claude/agents`, `.claude/skills`) serves both interactive use and CI. No separate orchestration framework. |
| **Deterministic runner around a narrowly scoped agent** | AI is used for judgment only. Selecting targets, restricting writes, running the tests, deciding what is accepted, and committing are ordinary code that can be unit-tested (`npm run test:pipeline`, 94 tests). |
| **One code path for local and CI** | `run.js` is the only entry point. CI runs its three stages (`--stage agent|verify|publish`); a local run does agent + verify in one process and skips the commit. What you test locally is what CI executes. |
| **AI-free verification** | The agent's own pass/fail numbers are informational. The numbers in the PR comment come from vitest runs the pipeline starts itself (focused run, full suite, coverage before/after). A generated test file that does not appear in vitest's results is rejected as "not executed"; a non-zero exit with no failed tests is treated as an error. |
| **Three jobs, least privilege per job** | The `agent` job holds the API key but only has read access to the repo. The `verify` job, which independently re-runs the generated tests, has no secrets. The `publish` job has write permission, never runs npm or tests, and runs only base-branch scripts on a hashed bundle. The `agent` job is the documented exception: it runs PR code and agent-run tests with `ANTHROPIC_API_KEY` in its environment (see section 7). |
| **Commits through the GitHub git-data REST API** | No git credentials on disk. The commit is created server side (blobs, tree, commit), then the branch ref is moved with `force: false` after checking that the branch is still at the PR head SHA the run started from (`stale` otherwise). Only test paths are accepted. |
| **`pull_request`, not `pull_request_target`** | `verify` executes PR code with a read-only token and no secrets; `publish` (write token) runs the base branch's runner scripts on a hash-validated bundle and executes no PR code. The one exception is the `agent` job, which runs PR code and agent-run tests with `ANTHROPIC_API_KEY` in its environment (section 7); it sets `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (present in the pinned CLI 2.1.295, confirmed in the installed binary) so the CLI strips credentials from the environment of its own subprocesses. The scrub runs Bash in a bubblewrap sandbox, so the job installs `bubblewrap` and `socat` and lifts Ubuntu 24.04's AppArmor restriction on unprivileged user namespaces; without it the CLI exits before the first turn. The sandbox leaves empty placeholder files at the repo root (`.npmrc`, `.env.*`, lockfiles and similar) and lists them in `.git/info/exclude`; the guard removes them without counting them as violations, but only when they are empty, at the root, on a fixed list, and the exclude change is append-only. Fork PRs are not processed (see limitations). |
| **Strict write guard** | The agent may write only `backend/tests/**`, `frontend/src/**/*.test.ts(x)`, `frontend/src/test/**` and `.agentic-tests/agent-report.json`. This is enforced twice: by permission rules in the CLI and by a filesystem snapshot guard that restores anything else (section 4). |
| **Sanitized comment output** | Everything the agent wrote is untrusted text that ends up in a PR comment, so it is escaped (section 4). Pipeline numbers come first; agent sections are length-capped. |
| **All-or-nothing agent output** | If any batch fails (crash, timeout, max turns, budget, bad report), all agent output is discarded and the status is `agent-failed`. No partial commits. |
| **Batching for `--all`** | Targets are split into batches of 8 files, each with its own turn limit and `$5` budget cap, so large codebases do not blow one context window. For `--all`, files already at 90 % lines and 80 % branches are filtered out before the agent runs. |
| **Sonnet as the default model** | Good cost/quality trade-off for test writing. Pinned to `claude-sonnet-5-5` in `agent-config.json`, overridable with the env var `AGENTIC_TESTS_MODEL`. Pinning matters: in a probe, an agent run without `--model` used a different default model. |
| **Pinned toolchain** | Workflow actions are pinned by commit SHA, the Claude Code CLI is pinned (`@anthropic-ai/claude-code@2.1.295`), Node is 22.12, and the runner scripts use Node builtins only (no new npm dependencies). |

## 3. Prerequisites and setup

**CI**
- The repository is public on GitHub.
- Repository secret `ANTHROPIC_API_KEY`. Ideally a dedicated workspace key with a spend limit.
- Settings -> Actions -> General -> Workflow permissions: "Read and write permissions". The workflow sets `permissions: {}` at the top level and grants only what each job needs, so this repo setting is a ceiling, not what the jobs get.
- The pipeline itself must be on the base branch: push it to `main` before opening feature PRs (see section 7, PR-supplied runner scripts).
- Optional label `skip-agentic-tests` on a PR to skip the pipeline.
- Job timeouts: the `agent` job allows 60 minutes (coverage plus two 20-minute agent batches can exceed 30); each agent batch is killed after 20 minutes (`timeoutMinutes` in `agent-config.json`); `verify` has 20 and `publish` 10.
- The workflow triggers on `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`) when `backend/src/**`, `frontend/src/**`, the workflow file or `scripts/agentic-tests/**` change. Draft PRs are skipped. A new push cancels the previous run for the same PR (`concurrency`). The agent job also skips when the head commit message contains `[agentic-tests]`, so the bot's own commit does not start another run.

**Public-repo hardening (repository settings, both enabled on this repo)**

Anyone can fork a public repo and open a PR. GitHub never passes secrets to fork-PR workflows on `pull_request` and gives them a read-only token, even if the fork edits the workflow file. On top of that, the workflow skips the `agent`, `verify` and `publish` jobs for forks. Two settings close what is left:

- **Fork PR approval.** Settings -> Actions -> General -> "Approval for running fork pull request workflows from contributors" -> **Require approval for all external contributors**. No workflow runs for an outside PR until a maintainer approves it, so strangers cannot spend the repo's Actions minutes. The section only appears on public repositories.
- **Ruleset on `main`.** Settings -> Rules -> Rulesets -> New branch ruleset, targeting the default branch, enforcement Active:
  - Restrict deletions.
  - Block force pushes.
  - Require a pull request before merging. Required approvals is 0 for a solo maintainer, because GitHub does not allow approving your own PR; set it to 1 when there is a second reviewer.
  - The Repository admin role is on the bypass list.

  Workflow changes from a PR therefore reach `main`, where they would run with secrets, only through a merged PR.
- The Agentic tests checks are deliberately **not** required status checks. The `paths` filter means docs-only PRs never start the workflow, and a required check that never runs blocks the merge forever. `agent-failed` is also non-blocking by design.
- Bot commits go to PR branches, never to `main`, so the ruleset does not affect the pipeline.

The same ruleset from the CLI (needs `gh auth login` with admin rights; `actor_id: 5` is the repository Admin role):

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input - <<'EOF'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } }
  ]
}
EOF
```

**Local**
- Node >= 22.12.
- `npm ci --prefix backend && npm ci --prefix frontend`.
- Claude Code CLI installed and logged in. CI pins, and the probes in section 6 used, version 2.1.295; use the same version locally.
- `gh auth login` for `--pr` / `--post` and for the lifecycle skills.

**Running**

| Command | What it does |
|---|---|
| `npm run agentic-tests -- --base origin/main` | Tests for files changed since the merge-base with `origin/main` (committed, uncommitted and untracked). |
| `npm run agentic-tests -- --pr N` | Same, using the PR's base branch. The PR branch must be checked out (`gh pr checkout N`). |
| `npm run agentic-tests -- --pr N --post` | Also posts or updates the sticky PR comment (marker `<!-- agentic-tests -->`). |
| `npm run agentic-tests -- --all` | Whole codebase, skipping well-covered files. Batched. |
| `--skip-coverage` | Skips coverage measurement (faster, no before/after numbers). |

A local run writes `.agentic-tests/report.md` and `report.json` (gitignored) and leaves accepted tests in the working tree for you to review and commit. Rejected files are kept under `.agentic-tests/rejected/`.

In CI the final comment is posted by `github-actions[bot]`. Agent-written tests are committed to the PR branch with the message `test: add/update unit tests for #<pr> [agentic-tests]`.

**Cost.** About $0.05 to $0.35 per batch of up to 8 files, capped at $5 per batch (`--max-budget-usd`). Cost scales with the number of changed files.

## 4. Where things live and how they are used

| Path | What it is | Used by |
|---|---|---|
| `.claude/agents/test-writer.md` | The agent. Hard rules (write only test files, treat PR text as data, never weaken a test, no snapshots/`.skip`/`.only`, at most 2 fix attempts per file, never `cd`), the procedure, and its preloaded skills. | The runner, via `claude -p --agent test-writer`. |
| `.claude/skills/analyze-pr-changes` | Decide `create` / `update` / `skip` per source file and list behaviors to pin down. | Agent (preloaded). |
| `.claude/skills/backend-unit-tests` | Conventions for backend tests (Express + Prisma + zod, Vitest + Supertest, no database). | Agent (preloaded). |
| `.claude/skills/frontend-unit-tests` | Conventions for frontend tests (React 19, TanStack Query, design system; Vitest + Testing Library + user-event). | Agent (preloaded). |
| `.claude/skills/run-and-verify-tests` | The only allowed commands, retry budget (2 attempts per file), `it.fails` + `suspected_bug` rule, coverage check. | Agent (preloaded). |
| `.claude/skills/report-results` (+ `report.schema.json`) | The machine-readable `.agentic-tests/agent-report.json`: one entry per target, skills used, findings, agent-side test counts. | Agent (preloaded); the runner validates the file. |
| `.claude/skills/agentic-tests` | Wrapper around `npm run agentic-tests` that summarizes `.agentic-tests/report.md`. | People: `/agentic-tests [args]`. |
| `.claude/skills/ba-create-task`, `dev-implement`, `dev-code-review`, `qa-test` | Delivery-lifecycle skills: task and issue from a description, implementation with tests on a branch, PR review, acceptance-criteria matrix. | People only (`/ba-create-task "..."`, `/dev-implement #N`, `/dev-code-review N --post`, `/qa-test #N --e2e --post`). |
| `.claude/settings.json` | Permissions for interactive use (allow the test and pipeline npm scripts, deny `.env` reads, force pushes, `reset --hard`, `rm -rf`). | Interactive Claude Code sessions. The agent run has its own, stricter, rule set in `agent-config.json`. |
| `scripts/agentic-tests/agent-config.json` | Model, `maxTurns` 60, `maxBudgetUsd` 5, 20-minute timeout, `batchSize` 8, allowed and denied tools. | `agent.js`. |
| `scripts/agentic-tests/run.js` | Entry point for local mode and the three CI stages. | `npm run agentic-tests`, the workflow. |
| `scripts/agentic-tests/classify-changes.js`, `paths.js`, `git.js` | Pick targets (backend/frontend source, minus types, barrels, stories, bootstrap, design system, generated code), map source to test path, safe git helpers. | `run.js`. |
| `scripts/agentic-tests/agent.js` | Build the CLI call and prompt, batch the targets, validate each agent report. | `run.js`. |
| `scripts/agentic-tests/guard.js` | Snapshot, detect and undo non-test changes, validate patches. | `run.js`. |
| `scripts/agentic-tests/verify.js` | Run vitest (JSON reporter), coverage, the reject/retry loop. | `run.js`. |
| `scripts/agentic-tests/render-report.js` | Validate the agent report schema, render and sanitize the Markdown comment. | `run.js`. |
| `scripts/agentic-tests/publish.js` | `gh api` wrappers: sticky comment upsert, commit via the git-data API. | `run.js` (publish stage, `--post`). |
| `scripts/agentic-tests/test/*.test.js` | Pipeline tests (node:test): CLI args, guard, verify, publish, render, classify, hermetic end-to-end and CI-stage runs with a fake agent. | `npm run test:pipeline`. |
| `.github/workflows/agentic-tests.yml` | The three-job workflow plus the fork notice. | GitHub Actions. |

### How they are used during execution

1. **Classify.** `classify-changes.js` turns the changed-file list into backend and frontend targets, plus a map of existing test files. Everything else is listed as skipped with a reason.
2. **Agent call.** `agent.js` runs `claude -p --agent test-writer` with `--model`, `--max-turns`, `--max-budget-usd`, `--permission-mode dontAsk`, `--strict-mcp-config` (no MCP servers) and `--setting-sources project` (only this repo's agent and skills load; user-level plugins and skills do not leak in). The prompt lists the targets and puts the diff inside an `<untrusted_pr_data>` block; any closing tag inside the diff is neutralized. The agent process gets an allow-listed environment, so `GH_TOKEN` never reaches it.
3. **Skills inside the agent.** The agent front matter preloads the five test skills. For each target the agent applies `analyze-pr-changes` (decision), then `backend-unit-tests` or `frontend-unit-tests` (write), then `run-and-verify-tests` (run, fix, coverage), and finally writes the report with `report-results`.
4. **Permissions.** The CLI does not accept `Write(path)` rules; `Edit(path)` rules govern all file-writing tools, so the allow list is built from `Edit(...)`. Every `Edit` and `Read` rule is rewritten to be anchored at the repo root (`Edit(//<abs root>/...)`), because relative rules resolve against the session's current directory and caused intermittent write denials in a real run. Denied: `WebFetch`, `WebSearch`, `NotebookEdit`, `git`, `gh`, `curl`, `wget`, reading `.env`, and also the npm scripts that `.claude/settings.json` allows for interactive use (`npm run:*`, typecheck, format:check, the pipeline itself). The agent can only run `npm --prefix <pkg> test` and `... run test:coverage`.
5. **Report checks.** The agent report must be valid against the schema, must cover the batch exactly once per target, and each `test_file` must be an allowed test path. Otherwise the batch fails and the whole agent output is discarded.
6. **Guard (`guard.js`).** Before the agent runs, the tree is snapshotted with `lstat` (symlinks are never followed), including git control files (`info/exclude`, `config`, `hooks`). After the agent (and again after the verification run, because tests are arbitrary code) any change outside the allowed test paths is detected and restored. `enforce()` loops until the tree is clean, so a nested `.gitignore` cannot hide files. In CI the patch is validated by a strict grammar and cross-checked with `git apply --numstat`, which is the authority on touched paths. Every git call runs with `-c core.fsmonitor=false -c core.hooksPath=/dev/null`.
7. **Verification (`verify.js`).** Generated files are hashed before any test runs. Vitest then runs on the new files, then the full suite with coverage. A file that fails is rejected; files still failing after retries are rejected; a file modified during test execution is rejected. Vitest runs with a scrubbed environment (no `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`, tokens or `ACTIONS_*`).
8. **Publish.** `verify` writes a bundle (`report.json` plus the accepted files). `publish` checks the status, that every path is a test path, that the file list matches the hash map, and each file's sha256, then commits via the REST API and upserts the comment.
9. **Comment.** Statuses (`publish-failed` is produced only by the publish stage): `committed`, `tests-ready`, `nothing-to-test`, `no-changes`, `agent-failed`, `guard-violation`, `existing-tests-failing`, `stale`, `publish-failed`. Pipeline numbers come first. Agent text is capped and sanitized: HTML, `&` entities, `@mentions`, links and autolinks, `#123` references and table pipes are neutralized.

## 5. Example runs

### 5a. Coverage push (local run)

This was a real run of `npm run agentic-tests -- --all` against the existing app, to bring the unit tests up to a baseline. Full detail, including every manual review change, is in [docs/coverage-push-report.md](docs/coverage-push-report.md); the starting point is in [docs/coverage-baseline.md](docs/coverage-baseline.md).

**Setup.** Model `claude-sonnet-5-5`, `maxTurns` 60, `batchSize` 8, `$5` per batch. The coverage filter selected 23 targets (5 backend, 18 frontend) and split them into 3 batches.

**Two runs.**

| Run | Status | Turns | Cost |
|---|---|---|---|
| 1 | `agent-failed` | 111 | $0.87 |
| 2 | `tests-ready` | 118 | $0.85 |

- Run 1: in the third batch every write was refused (7 permission denials) and the agent finished without writing its report. The runner treated the batch as failed and discarded all of run 1's output, as designed (no partial commits). Root cause, found in review: the allow rules were relative (`Edit(frontend/src/**/*.test.ts)`), and relative rules resolve against the session's current directory. Fix: the runner now anchors every `Edit` and `Read` rule to the repo root, and the agent is forbidden to `cd`.
- Run 2: 23 test files created or updated, 0 rejected. Pipeline verification: backend 85/85, frontend 78/78 tests passing. The agent reported no `suspected_bug`. Its one finding was a `note` about a mock it had changed in `TodosPage.test.tsx`.

**Skills used (from the agent report):** `analyze-pr-changes`, `backend-unit-tests`, `frontend-unit-tests`, `run-and-verify-tests`, `report-results`.

**Decisions (examples).**

| Source | Decision | Reason (agent) |
|---|---|---|
| `backend/src/core/config.ts` | create | No test existed; covers override, psycopg rewrite, composed URL, name encoding and each missing variable. |
| `backend/src/features/todos/router.ts` | update | Existing test covered only list and create; added get, update, delete, 404 and id validation cases. |
| `frontend/src/lib/http.ts` | create | No test existed; covers success, 204, 422, detail, generic error, network error and abort paths. |
| `frontend/src/hooks/useNotice.ts` | update | Existing test only checked initial state; added 4-second auto-dismiss and timer restart cases with fake timers. |

Earlier, a smaller run on a single file (`backend/src/api/health.ts`) produced `backend/tests/health.test.ts` (3 cases, 18 turns, $0.068, status `tests-ready`). Its first attempt decided to skip because the diff was only a comment. That exposed a gap in the `analyze-pr-changes` skill: a file with runtime behavior but no test at all should not be skipped for a cosmetic diff. The skill was fixed and the rerun created the test.

**Coverage (package totals, lines / branches).**

| Package | Before (pipeline) | After agent (run 2) | After manual review |
|---|---|---|---|
| backend | 37.6 / 33.3 | 92.7 / 97.9 | 100 / 97.9 |
| frontend | 47.7 / 43.8 | 93.4 / 93.4 | 93.4 / 93.4 |

The backend figure after review excludes `src/main.ts` (process bootstrap), which was added to the coverage exclude list. Final suites: backend 89 tests, frontend 83 tests (see the "After" section of `docs/coverage-baseline.md`).

**Manual review.** Every generated file was reviewed against the skills. Most were kept as written. The changes I made by hand are listed in `docs/coverage-push-report.md`. In short: stronger assertions (exact arguments, full bodies, text instead of regexes, `mutationKey` checks), a race-prone negative assertion rewritten, one combined test split in two, a `getByTestId` query replaced, two type errors fixed (the agent cannot run typecheck), and shutdown-path tests added to `lifespan.test.ts` (75 % to 100 % lines).

**Thresholds now enforced.** Frontend: 90 % lines and 80 % branches (global). Backend: 80 % lines and 70 % branches per file, plus the existing 100 % on validators and mappers.

**Still below the bar.** `TodosPage.tsx` is at 69 % lines (the create, edit and delete handlers sit behind mocked children). `TodoForm.tsx` is at 87.5 % lines.

### 5b. Demo PR (stats feature)

Written with the delivery skills: `/ba-create-task` (task and issue), `/dev-implement` (feature branch, code, tests, PR), the Agentic tests workflow on the PR, `/dev-code-review` and `/qa-test`.

`/dev-implement` writes tests itself, so the workflow may legitimately report `no-changes` (every file is already covered). To demonstrate a bot commit, push a follow-up change that adds behavior without tests, for example a new branch in a frontend component. The second run then reports `committed`.

<!-- TODO after demo PR: PR link -->
**Pull request:** TODO

<!-- TODO after demo PR: sticky comment, copied verbatim from the PR -->
**Sticky comment from the workflow:**

> TODO

<!-- TODO after demo PR: decisions table (source, create/update/skip, reason) -->
**Agent decisions:** TODO

<!-- TODO after demo PR: skills used, turns, cost -->
**Skills used / turns / cost:** TODO

<!-- TODO after demo PR: verification and coverage numbers (passed/failed, lines/branches before -> after) -->
**Verification and coverage:** TODO

<!-- TODO after demo PR: bot commit SHA and link -->
**Bot commit:** TODO

<!-- TODO after demo PR: links to the code review and QA comments -->
**Code review:** TODO. **QA:** TODO.

## 6. Assumptions

- `tasks/` holds the lifecycle task files written by `/ba-create-task` and read by `/dev-implement` (for example `tasks/TASK-001-task-statistics.md`). `.env.example` lists the local and docker-compose defaults.

- Pull requests come from branches in this repository, by trusted collaborators.
- Unit tests only. The pipeline needs no database, network or browser; end-to-end checks are left to `/qa-test --e2e`.
- `main` is the base branch (the default for `--base` is `origin/main`).
- Backend sources live in `backend/src`, frontend sources in `frontend/src`; tests follow the existing layout (`backend/tests/<module>.test.ts`, `X.test.tsx` next to `X.tsx`).
- Claude Code CLI behavior, verified by probing version 2.1.295 before relying on it:
  - `--agent` works in headless mode (`-p --output-format json`), and the JSON result carries `subtype`, `num_turns`, `total_cost_usd` and `permission_denials`.
  - Without `--model` the agent used a different default model, so the runner always passes `--model`.
  - `Write(path)` allow rules are rejected with a message to use `Edit(path)`. `Edit(path)` rules authorize the Write tool (a test file was created; a production file was denied).
  - Under `--permission-mode dontAsk` a denied tool is reported in `permission_denials` and the agent continues; the run can still end with `subtype: success`, which is why the runner requires a valid report file.
  - Without `--setting-sources project`, user-level plugin skills appeared in the agent's skill list. With it, only project skills (and built-ins) load.
  - Relative `Edit` rules are not safe (section 4, point 4 and section 5a), so they are anchored.
  - `npm run:*` can be denied without blocking `npm --prefix <pkg> run test:coverage`.
- Coverage is measured with vitest and v8 using each package's existing configuration.

## 7. Limitations

- **Fork PRs are not processed.** Secrets are not available to them; a notice job explains this.
- **The agent step runs the PR's test code with the API key in its environment.** Generated tests are arbitrary code, and the Bash allowlist does not control what code inside a test does. Mitigations: same-repo PRs only, a spend-capped key, no network tools for the agent, and guard re-checks. A determined collaborator could still try to exfiltrate the key. A real fix needs a sandbox (section 8).
- **The agent log artifact is readable** by anyone with read access to the repository. It is uploaded only when the agent job fails (3-day retention), but it can then contain test output and whatever the agent echoed.
- **PR-supplied runner scripts affect the `agent` and `verify` jobs.** A collaborator who edits `scripts/agentic-tests/**` in a PR changes what those jobs run (with the API key / the read token). Acceptable only for same-repo trusted collaborators; `publish` is unaffected because it uses the base branch's scripts. For the same reason a PR that first introduces the pipeline cannot be published by it: if the base branch has no runner scripts, the `publish` job fails with `MODULE_NOT_FOUND` and **no comment** is posted. If the base has the scripts but the bundle is missing or invalid, the result is a `publish-failed` comment. Push the pipeline to `main` before opening feature PRs.
- **The bundle hash protects the bundle in transit, not its origin.** It guarantees that `publish` commits exactly the files that left the `verify` job, but code that ran inside `verify` (PR code, generated tests) could have forged the bundle contents. `publish` therefore rebuilds the report from validated fields only (known packages, integer counts, string-only lists, test paths only, no incoming commit data) and sanitizes everything it renders; it does not rely on the bundle being honest.
- **If the agent stage itself fails** (missing secret, CLI install failure, crash), only a red check appears and no PR comment is posted.
- **The agent log is uploaded only when the job fails**, so not for `agent-failed`, which exits 0.
- **Proxy and certificate env vars are not passed to the agent.**
- **The guard does not watch gitignored paths.** A test could write there; nothing from those paths is committed, but the guard cannot see it.
- **LLM output is non-deterministic.** Two runs on the same diff can produce different tests, and a run can fail intermittently (run 1 in section 5a).
- **Coverage is a weak proxy for test quality.** High coverage does not prove that the assertions are meaningful. Manual review of the coverage push still found weak assertions and one racy test.
- **Commits made with `GITHUB_TOKEN` do not trigger other workflows**, so required checks do not run automatically on the bot commit.
- **`TodosPage.tsx` is at 69 % lines**; the agent's tests do not exercise its create, edit and delete handlers.
- **Cost grows with the size of the diff**, and the agent only sees the first 60,000 characters of the diff (it is told to read the files directly beyond that).
- **The GitHub API commit** can only add or replace files under the allowed test paths; deletions of test files are rejected.

## 8. What to change for production

- Run test execution in a **separate, network-isolated, secret-less container or job**, with the agent only proposing code. The API key then never meets test code.
- Use a **GitHub App identity** (verified bot commits) and run required checks on the bot's commits.
- Handle **fork PRs** with a `workflow_run` workflow that only comments.
- Measure test quality with **mutation testing** (for example Stryker) on the changed files.
- Add an **eval suite for the skills**: golden diffs with expected decisions.
- Add **token and cost budgets per PR**, with reporting.
- **Cache** `node_modules` and the Prisma client.
- Use **structured output** (`--json-schema`), when available, instead of a report file.
- Add **OpenTelemetry traces** of agent runs.
- Add **CODEOWNERS** on `.claude/**`, `scripts/agentic-tests/**` and `.github/workflows/**`.
- Keep the agent log out of artifacts entirely, or restrict who can read it.
