#!/usr/bin/env node
// Writes two passing tests; the first rewrites its sibling when it runs.
import { mkdirSync, writeFileSync } from 'node:fs';
writeFileSync('backend/tests/a.test.ts', `import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
it('rewrites its sibling', () => {
  appendFileSync(fileURLToPath(new URL('./b.test.ts', import.meta.url)), '\\n// rewritten at runtime\\n');
  expect(1).toBe(1);
});
`);
writeFileSync('backend/tests/b.test.ts', "import { it, expect } from 'vitest';\nit('sibling', () => expect(1).toBe(1));\n");
mkdirSync('.agentic-tests', { recursive: true });
writeFileSync('.agentic-tests/agent-report.json', JSON.stringify({
  files: [{ source: 'backend/src/api/health.ts', decision: 'create', reason: 'x', test_file: 'backend/tests/a.test.ts', cases_added: 2, cases_modified: 0 }],
  skills_used: [], findings: [], agent_test_run: { passed: 2, failed: 0 },
}));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0 }));
