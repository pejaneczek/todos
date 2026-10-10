---
name: agentic-tests
description: Run the Taskly agentic unit-test pipeline locally (analyze changes → test-writer agent → guard → independent verification → report). Use when asked to generate or update unit tests for current changes, a PR, or the whole codebase.
argument-hint: "[--base <ref> | --pr <n> [--post] | --all] [--skip-coverage]"
---

1. From the repo root, run `npm run agentic-tests -- $ARGUMENTS`. If no arguments were given, use `--base origin/main`. The run takes several minutes, so set a long Bash timeout.
2. Read `.agentic-tests/report.md` and summarize: status, per-file decisions, rejected tests (with reasons), findings (put `suspected_bug` first), and coverage before → after.
3. If the status is `guard-violation`, say so prominently: the agent tried to change non-test files, they were restored, and its output was discarded.
4. Never commit or push the generated tests. List the changed test files so the user can review and commit them.
