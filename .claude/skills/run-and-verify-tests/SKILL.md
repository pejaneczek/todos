---
name: run-and-verify-tests
description: Run and fix Taskly unit tests you just wrote, with a strict retry budget and coverage check. Use after creating or updating any test file.
---

# Run and verify tests

Allowed commands (nothing else; run them from the repo root):
```
npm --prefix backend test -- <path relative to backend, e.g. tests/health.test.ts>
npm --prefix frontend test -- <path relative to frontend, e.g. src/lib/http.test.ts>
npm --prefix backend run test:coverage
npm --prefix frontend run test:coverage
```

1. Run only the test files you created or changed.
2. On failure, read the error and decide:
   - **The test is wrong** (bad mock, wrong import path, wrong query): fix the test. At most 2 attempts per file.
   - **The code is wrong** (the expectation matches the documented or obvious intent): keep the expectation, change `it(` to `it.fails(`, and record a `suspected_bug` finding.
3. Run the package's full suite (`npm --prefix <pkg> test`) once, to catch interference with other tests (shared mocks, fixture changes).
4. Run coverage for the package. For each target file, check its line and branch percentages in the text table. If either is below 80 %, add cases for the uncovered lines once, then re-run.
5. Record the final passed/failed counts for the report.

The pipeline re-runs everything independently. Your numbers are informational, so report them honestly.
