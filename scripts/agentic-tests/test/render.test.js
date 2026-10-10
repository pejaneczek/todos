import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKER, renderMarkdown, sanitize, validateAgentReport } from '../render-report.js';

const agentReport = {
  files: [
    { source: 'backend/src/api/health.ts', decision: 'create', reason: 'no test existed', test_file: 'backend/tests/health.test.ts', cases_added: 2, cases_modified: 0 },
    { source: 'backend/src/core/config.ts', decision: 'skip', reason: 'comment-only change' },
  ],
  skills_used: ['analyze-pr-changes', 'backend-unit-tests'],
  findings: [{ type: 'suspected_bug', file: 'backend/src/api/health.ts', detail: 'returns 500 <b>@alice</b>' }],
  agent_test_run: { passed: 999, failed: 0 },
};

test('validateAgentReport accepts a valid report and explains invalid ones', () => {
  assert.deepEqual(validateAgentReport(agentReport), []);
  assert.deepEqual(validateAgentReport([]), ['report is not an object']);
  const errors = validateAgentReport({ files: [{ source: 'x', decision: 'rewrite', reason: '' }], skills_used: 'no', findings: [{ type: 'x' }] });
  assert.ok(errors.includes('files[0].decision must be create|update|skip'));
  assert.ok(errors.includes('files[0].reason is required'));
  assert.ok(errors.includes('skills_used must be an array of strings'));
  assert.ok(errors.includes('findings[0].type is invalid'));
  assert.ok(errors.includes('agent_test_run must be an object'));
});

test('sanitize neutralizes HTML, mentions, table pipes, newlines and length', () => {
  assert.equal(sanitize('<img src=x> @bob a|b\nc'), '&lt;img src=x&gt; @​bob a\\|b c');
  assert.equal(sanitize('x'.repeat(400)).length, 300);
});

test('renderMarkdown uses pipeline numbers, not agent numbers, and sanitizes agent text', () => {
  const md = renderMarkdown({
    status: 'committed',
    context: { mode: 'ci', pr: 12 },
    classification: { backend: ['backend/src/api/health.ts'], frontend: [], skipped: [{ file: 'README.md', reason: 'not application source' }], existingTests: {} },
    agent: { ok: true, errors: [], turns: 7, costUsd: 0.4123, report: agentReport },
    guard: { violations: [] },
    changes: { created: ['backend/tests/health.test.ts'], modified: [], deleted: [] },
    accepted: ['backend/tests/health.test.ts'],
    rejected: [],
    verification: { backend: { passed: 42, failed: 0, total: 42, failures: [], thresholdsFailed: false } },
    coverage: { before: { backend: { lines: 80, branches: 70 } }, after: { backend: { lines: 92.5, branches: 85 } } },
    commit: { status: 'committed', sha: 'abc1234def' },
  });
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /Tests added and committed/);
  assert.match(md, /\| `backend\/src\/api\/health.ts` \| create \|/);
  assert.match(md, /\| backend \| 42 \| 0 \| 80.0% → 92.5% \| 70.0% → 85.0% \|/);
  assert.doesNotMatch(md, /999/);
  assert.doesNotMatch(md, /<b>/);
  assert.match(md, /@​alice/);
  assert.match(md, /abc1234/);
});

// ---- fix round 1 regression tests ----

const ZW = '​';
const baseReport = (extra = {}) => ({
  status: 'tests-ready',
  context: { mode: 'ci', pr: 1 },
  classification: { backend: [], frontend: [], skipped: [], existingTests: {} },
  agent: { ok: true, errors: [], turns: 1, costUsd: 0.1, report: null },
  guard: { violations: [] },
  changes: { created: [], modified: [], deleted: [] },
  accepted: [],
  rejected: [],
  verification: {},
  coverage: { before: {}, after: {} },
  ...extra,
});
const reportWith = (agentRep, extra = {}) => baseReport({ agent: { ok: true, errors: [], turns: 1, costUsd: 0.1, report: agentRep }, ...extra });
const delimiterCount = (line) => {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '|') n++;
  }
  return n;
};

test('sanitize: escaped pipe stays inside the table cell', () => {
  const md = renderMarkdown(reportWith({
    files: [{ source: 'a.ts', decision: 'skip', reason: 'bad \\| cell' }],
    skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 0 },
  }));
  const row = md.split('\n').find((l) => l.startsWith('| `a.ts`'));
  assert.ok(row, 'decision row rendered');
  assert.equal(delimiterCount(row), 6);
});

test('sanitize: markdown links and images are neutralized', () => {
  const link = sanitize('[x](http://e.com)');
  const img = sanitize('![](http://e.com)');
  assert.doesNotMatch(link, /(^|[^\\])\[/);
  assert.doesNotMatch(link, /(?<!\\)\]\(http/);
  assert.doesNotMatch(img, /(^|[^\\])\[/);
  assert.doesNotMatch(img, /(?<!\\)\]\(http/);
});

test('sanitize: HTML closers and comment markers never appear raw', () => {
  const out = sanitize('</details> <!-- agentic-tests -->');
  assert.doesNotMatch(out, /<\/details>/);
  assert.doesNotMatch(out, /<!--/);
  assert.doesNotMatch(out, /-->/);
});

test('sanitize: entity-encoded mention is not decoded into a live mention', () => {
  const out = sanitize('&#64;bob');
  assert.ok(out.startsWith('&amp;'));
  assert.equal(out.replace(/​/g, ''), '&amp;#64;bob');
  assert.doesNotMatch(out, /&#64;/);
});

test('sanitize: autolinks and issue references are broken', () => {
  assert.ok(sanitize('http://evil.com').includes(ZW));
  assert.equal(sanitize('http://evil.com'), `http:${ZW}//evil.com`);
  assert.equal(sanitize('www.evil.com'), `www${ZW}.evil.com`);
  assert.equal(sanitize('WWW.evil.com'), `WWW${ZW}.evil.com`);
  assert.equal(sanitize('#12'), `${ZW}#12`);
});

test('sanitize: emails are broken at the @', () => {
  assert.equal(sanitize('a@b.com'), `a@${ZW}b.com`);
});

test('renderMarkdown: agent object without errors does not throw', () => {
  assert.doesNotThrow(() => renderMarkdown({ status: 'agent-failed', context: { mode: 'ci' }, agent: { ok: false } }));
});

test('renderMarkdown: decisions are capped at 100 with a more-files line', () => {
  const files = Array.from({ length: 150 }, (_, i) => ({ source: `src/f${i}.ts`, decision: 'skip', reason: 'r' }));
  const md = renderMarkdown(reportWith({ files, skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 0 } }));
  const rows = md.split('\n').filter((l) => l.startsWith('| `src/f'));
  assert.equal(rows.length, 100);
  assert.ok(md.includes('…and 50 more files (see report.json artifact)'));
});

test('renderMarkdown: findings capped at 30 and rejected at 50', () => {
  const findings = Array.from({ length: 40 }, (_, i) => ({ type: 'note', file: `f${i}.ts`, detail: 'd' }));
  const rejected = Array.from({ length: 60 }, (_, i) => ({ file: `t${i}.test.ts`, reason: 'x' }));
  const md = renderMarkdown(reportWith({ files: [], skills_used: [], findings, agent_test_run: { passed: 0, failed: 0 } }, { rejected }));
  assert.equal(md.split('\n').filter((l) => l.startsWith('- **note**')).length, 30);
  assert.equal(md.split('\n').filter((l) => l.startsWith('- `t')).length, 50);
});

test('renderMarkdown: verification heading comes before decisions', () => {
  const md = renderMarkdown(reportWith(
    { files: [{ source: 'a.ts', decision: 'skip', reason: 'r' }], skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 0 } },
    { verification: { backend: { passed: 1, failed: 0, total: 1, failures: [], thresholdsFailed: false } } },
  ));
  assert.ok(md.indexOf('### Verification') > -1);
  assert.ok(md.indexOf('### Verification') < md.indexOf('### Decisions'));
});

test('renderMarkdown: decisions column header names the agent-reported counts', () => {
  const md = renderMarkdown(reportWith({ files: [{ source: 'a.ts', decision: 'skip', reason: 'r' }], skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 0 } }));
  assert.ok(md.includes('| Cases (+/~, agent-reported) |'));
});

test('renderMarkdown: a 70k report is truncated to <= 60000 chars and its open details is closed', () => {
  const skills = Array.from({ length: 400 }, (_, i) => `skill-${i}-${'x'.repeat(190)}`);
  const md = renderMarkdown(reportWith({ files: [], skills_used: skills, findings: [], agent_test_run: { passed: 0, failed: 0 } }));
  assert.ok(md.length <= 60000);
  assert.ok(md.endsWith('_(truncated)_') || md.includes('_(truncated)_'));
  const opens = md.match(/<details>/g)?.length ?? 0;
  const closes = md.match(/<\/details>/g)?.length ?? 0;
  assert.equal(opens, closes);
});

test('validateAgentReport: rejects too many files and findings, bad counts and types', () => {
  const many = (n, f) => Array.from({ length: n }, f);
  const e1 = validateAgentReport({ files: many(201, () => ({ source: 'x', decision: 'skip', reason: 'r' })), skills_used: [], findings: [], agent_test_run: { passed: 0, failed: 0 } });
  assert.ok(e1.includes('files has too many entries (max 200)'));
  const e2 = validateAgentReport({ files: [], skills_used: [], findings: many(51, () => ({ type: 'note', file: 'f', detail: 'd' })), agent_test_run: { passed: 0, failed: 0 } });
  assert.ok(e2.includes('findings has too many entries (max 50)'));
  const e3 = validateAgentReport({
    files: [{ source: 'x', decision: 'create', reason: 'r', test_file: 't', cases_added: -1, cases_modified: 1.5 }],
    skills_used: [],
    findings: [{ type: 'note', file: 1, detail: null }],
    agent_test_run: { passed: -1, failed: 'a' },
  });
  assert.ok(e3.includes('files[0].cases_added must be a non-negative integer'));
  assert.ok(e3.includes('files[0].cases_modified must be a non-negative integer'));
  assert.ok(e3.includes('findings[0].file must be a string'));
  assert.ok(e3.includes('findings[0].detail must be a string'));
  assert.ok(e3.includes('agent_test_run.passed must be a non-negative integer'));
  assert.ok(e3.includes('agent_test_run.failed must be a non-negative integer'));
});
