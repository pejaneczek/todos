#!/usr/bin/env node
// Writes a passing test and a valid report, then reports a failed run (max turns, non-zero exit).
import { mkdirSync, writeFileSync } from 'node:fs';
writeFileSync('backend/tests/health.test.ts', `import { it, expect } from 'vitest';
it('passes but the agent run failed', () => expect(1).toBe(1));
`);
mkdirSync('.agentic-tests', { recursive: true });
writeFileSync('.agentic-tests/agent-report.json', JSON.stringify({
  files: [{ source: 'backend/src/api/health.ts', decision: 'create', reason: 'x', test_file: 'backend/tests/health.test.ts', cases_added: 1, cases_modified: 0 }],
  skills_used: [], findings: [], agent_test_run: { passed: 1, failed: 0 },
}));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 99, total_cost_usd: 0 }));
process.exitCode = 1;
