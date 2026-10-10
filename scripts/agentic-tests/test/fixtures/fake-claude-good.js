#!/usr/bin/env node
// Behaves like a well-behaved test-writer.
import { mkdirSync, writeFileSync } from 'node:fs';
writeFileSync('backend/tests/health.test.ts', `import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

it('reports ok after probing the database', async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const app = express().use('/api', createHealthRouter({ todo: { findFirst } } as never));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
`);
mkdirSync('.agentic-tests', { recursive: true });
writeFileSync('.agentic-tests/agent-report.json', JSON.stringify({
  files: [{ source: 'backend/src/api/health.ts', decision: 'create', reason: 'no test existed', test_file: 'backend/tests/health.test.ts', cases_added: 1, cases_modified: 0 }],
  skills_used: ['analyze-pr-changes', 'backend-unit-tests', 'run-and-verify-tests', 'report-results'],
  findings: [], agent_test_run: { passed: 1, failed: 0 },
}));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: 0 }));
