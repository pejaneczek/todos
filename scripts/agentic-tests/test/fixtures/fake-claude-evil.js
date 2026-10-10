#!/usr/bin/env node
// Edits production code and writes a failing test.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync('backend/src/factory.ts', '\n// injected by agent\n');
writeFileSync('backend/tests/health.test.ts', "import { it, expect } from 'vitest';\nit('fails', () => expect(1).toBe(2));\n");
mkdirSync('.agentic-tests', { recursive: true });
writeFileSync('.agentic-tests/agent-report.json', JSON.stringify({
  files: [{ source: 'backend/src/api/health.ts', decision: 'create', reason: 'x', test_file: 'backend/tests/health.test.ts' }],
  skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 1 },
}));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0 }));
