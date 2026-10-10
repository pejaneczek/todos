---
name: report-results
description: Write the machine-readable test-writer report consumed by the agentic-tests pipeline. Use as the last step of every test-writer run.
---

# Report results

Write `.agentic-tests/agent-report.json` (schema: `.claude/skills/report-results/report.schema.json`):

```json
{
  "files": [
    { "source": "backend/src/api/health.ts", "decision": "create", "reason": "No test existed; covers ok response and the database probe.", "test_file": "backend/tests/health.test.ts", "cases_added": 2, "cases_modified": 0 },
    { "source": "backend/src/features/todos/types.ts", "decision": "skip", "reason": "Type-only change." }
  ],
  "skills_used": ["analyze-pr-changes", "backend-unit-tests", "run-and-verify-tests", "report-results"],
  "findings": [
    { "type": "suspected_bug", "file": "backend/src/x.ts", "detail": "Returns 500 for an empty body; expected 422. Case marked it.fails." }
  ],
  "agent_test_run": { "passed": 12, "failed": 0 }
}
```

Rules:
- One `files` entry per target, no more and no fewer. `test_file` is required unless `decision` is `skip`.
- `reason`: one sentence, at most 300 characters, factual.
- `skills_used`: the skills you actually applied.
- Valid JSON only: no comments, no trailing commas. The pipeline rejects invalid reports.
