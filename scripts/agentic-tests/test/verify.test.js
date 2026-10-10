import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVitestJson, runVitest, summarizeCoverage, verifyGenerated } from '../verify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const root = '/repo';
const vitestJson = {
  numPassedTests: 3, numFailedTests: 1, numTotalTests: 4,
  testResults: [
    { name: '/repo/backend/tests/a.test.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'a works', status: 'passed', failureMessages: [] }] },
    { name: '/repo/backend/tests/b.test.ts', status: 'failed', message: '', assertionResults: [{ fullName: 'b breaks', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }] },
    { name: '/repo/backend/tests/c.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [] },
  ],
};

test('parseVitestJson reports repo-relative failed files including suite errors', () => {
  const r = parseVitestJson(vitestJson, root);
  assert.equal(r.passed, 3);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.failedFiles, ['backend/tests/b.test.ts', 'backend/tests/c.test.ts']);
  assert.deepEqual(r.failures.map((f) => f.name), ['b breaks', '(suite failed to run)']);
});

test('parseVitestJson returns ranFiles for every executed test file, passed or failed', () => {
  const r = parseVitestJson(vitestJson, root);
  assert.deepEqual(r.ranFiles, ['backend/tests/a.test.ts', 'backend/tests/b.test.ts', 'backend/tests/c.test.ts']);
  assert.deepEqual(parseVitestJson({ numPassedTests: 0, numFailedTests: 0, numTotalTests: 0, testResults: [] }, root).ranFiles, []);
});

test('summarizeCoverage keeps totals and repo-relative files', () => {
  const m = { lines: { pct: 90 }, branches: { pct: 80 }, functions: { pct: 70 }, statements: { pct: 60 } };
  const s = summarizeCoverage({ total: m, '/repo/backend/src/a.ts': m }, root);
  assert.deepEqual(s.total, { lines: 90, branches: 80, functions: 70, statements: 60 });
  assert.deepEqual(Object.keys(s.files), ['backend/src/a.ts']);
});

test('verifyGenerated rejects failing generated tests and keeps existing-suite status', () => {
  const calls = [];
  const rejected = [];
  const results = [
    { passed: 1, failed: 1, total: 2, failedFiles: ['backend/tests/new.test.ts'], failures: [{ file: 'backend/tests/new.test.ts', name: 'x', message: 'boom' }], ranFiles: ['backend/tests/new.test.ts', 'backend/tests/ok.test.ts'], thresholdsFailed: false },
    { passed: 10, failed: 0, total: 10, failedFiles: [], failures: [], thresholdsFailed: false, coverage: { total: { lines: 91, branches: 81 }, files: {} } },
  ];
  const run = (opts) => { calls.push(opts); return results.shift(); };
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: true, run,
    changes: { created: ['backend/tests/new.test.ts', 'backend/tests/ok.test.ts'], modified: [], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.deepEqual(calls[0].files, ['backend/tests/new.test.ts', 'backend/tests/ok.test.ts']);
  assert.deepEqual(rejected, ['created:backend/tests/new.test.ts']);
  assert.equal(out.rejected[0].reason, 'x: boom');
  assert.equal(out.existingFailing, false);
  assert.deepEqual(out.coverageAfter, { backend: { lines: 91, branches: 81 } });
});

test('verifyGenerated flags existing failures that are not generated', () => {
  const run = () => ({ passed: 1, failed: 1, total: 2, failedFiles: ['backend/tests/router.test.ts'], failures: [], ranFiles: [], thresholdsFailed: false });
  const out = verifyGenerated({ root, packages: ['backend'], coverage: false, run, changes: { created: [], modified: [], deleted: [] }, reject: () => {} });
  assert.equal(out.existingFailing, true);
});

test('verifyGenerated rejects a requested test file that vitest never executed', () => {
  const rejected = [];
  const run = () => ({ passed: 1, failed: 0, total: 1, failedFiles: [], failures: [], ranFiles: ['backend/tests/ok.test.ts'], thresholdsFailed: false });
  verifyGenerated({
    root, packages: ['backend'], coverage: false, run,
    changes: { created: ['backend/tests/new.test.ts', 'backend/tests/ok.test.ts'], modified: [], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.deepEqual(rejected, ['created:backend/tests/new.test.ts']);
});

test('verifyGenerated reason for a file vitest never executed is "not executed by vitest"', () => {
  const run = () => ({ passed: 0, failed: 0, total: 0, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false });
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: false, run,
    changes: { created: ['backend/tests/ghost.test.ts'], modified: [], deleted: [] }, reject: () => {},
  });
  assert.equal(out.rejected[0].reason, 'not executed by vitest');
});

test('verifyGenerated rejects every file of a batch when the phase 1 run errors', () => {
  const rejected = [];
  const results = [
    { passed: 0, failed: 0, total: 0, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false, error: 'vitest produced no report (exit 1)' },
    { passed: 5, failed: 0, total: 5, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false },
  ];
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: false, run: () => results.shift(),
    changes: { created: ['backend/tests/a.test.ts', 'backend/tests/b.test.ts'], modified: [], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.deepEqual(rejected, ['created:backend/tests/a.test.ts', 'created:backend/tests/b.test.ts']);
  assert.ok(out.rejected.every((x) => x.reason.startsWith('test run did not start')));
});

test('verifyGenerated rejects generated test files whose package is not verified', () => {
  const rejected = [];
  const calls = [];
  const run = (opts) => { calls.push(opts); return { passed: 1, failed: 0, total: 1, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false }; };
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: false, run,
    changes: { created: ['frontend/src/x.test.tsx'], modified: [], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.deepEqual(rejected, ['created:frontend/src/x.test.tsx']);
  assert.equal(out.rejected[0].reason, 'package not verified');
  assert.ok(calls.every((c) => c.pkg === 'backend'));
});

test('verifyGenerated blames and undoes a shared helper when the suite fails without a generated test failing', () => {
  const rejected = [];
  const results = [
    { passed: 0, failed: 1, total: 1, failedFiles: ['backend/tests/router.test.ts'], failures: [], ranFiles: [], thresholdsFailed: false },
    { passed: 2, failed: 0, total: 2, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false },
  ];
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: false, run: () => results.shift(),
    changes: { created: [], modified: ['backend/tests/fixture.ts'], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.deepEqual(rejected, ['modified:backend/tests/fixture.ts']);
  assert.equal(out.rejected[0].reason, 'shared test helper change broke the suite');
  assert.equal(out.existingFailing, false);
});

test('verifyGenerated rejects files still failing after the retry budget, then verifies the final tree', () => {
  const rejected = [];
  const failing = (f) => ({ passed: 0, failed: 1, total: 1, failedFiles: [f], failures: [{ file: f, name: 'n', message: 'm' }], ranFiles: [f], thresholdsFailed: false });
  const passing = { passed: 1, failed: 0, total: 1, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false };
  const results = [
    { ...passing, ranFiles: ['backend/tests/a.test.ts', 'backend/tests/b.test.ts', 'backend/tests/c.test.ts', 'backend/tests/d.test.ts'] }, // phase 1
    failing('backend/tests/a.test.ts'),
    failing('backend/tests/b.test.ts'),
    failing('backend/tests/c.test.ts'),
    failing('backend/tests/d.test.ts'), // attempts exhausted, still failing
    passing, // final verification run
  ];
  const calls = [];
  const out = verifyGenerated({
    root, packages: ['backend'], coverage: false, run: (o) => { calls.push(o); return results.shift(); },
    changes: { created: ['backend/tests/a.test.ts', 'backend/tests/b.test.ts', 'backend/tests/c.test.ts', 'backend/tests/d.test.ts'], modified: [], deleted: [] },
    reject: (file, kind) => rejected.push(`${kind}:${file}`),
  });
  assert.equal(calls.length, 6);
  assert.equal(out.rejected.find((x) => x.file === 'backend/tests/d.test.ts').reason, 'still failing after retries');
  assert.equal(rejected.length, 4);
  assert.equal(out.existingFailing, false);
  assert.equal(out.verification.backend.failed, 0);
});

test('verifyGenerated reports failed as at least the number of failed files', () => {
  const run = () => ({ passed: 0, failed: 0, total: 0, failedFiles: ['backend/tests/router.test.ts'], failures: [], ranFiles: [], thresholdsFailed: false });
  const out = verifyGenerated({ root, packages: ['backend'], coverage: false, run, changes: { created: [], modified: [], deleted: [] }, reject: () => {} });
  assert.equal(out.verification.backend.failed, 1);
});

// runVitest with an injected spawn: the fake writes the JSON report to the --outputFile path it receives.
function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
function fakeSpawn(result, report) {
  return (_cmd, args) => {
    const out = args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
    if (report !== undefined) writeFileSync(out, report);
    return result;
  };
}
const okReport = JSON.stringify({ numPassedTests: 1, numFailedTests: 0, numTotalTests: 1, testResults: [{ name: '/x/backend/tests/a.test.ts', status: 'passed', message: '', assertionResults: [] }] });

test('runVitest: a non-zero exit with no failed files and a coverage threshold message is thresholdsFailed, not an error', () => {
  const t = tempRoot();
  try {
    const spawn = fakeSpawn({ status: 1, signal: null, error: undefined, stdout: 'ERROR: Coverage for lines (33%) does not meet global threshold (80%)', stderr: '' }, okReport);
    const r = runVitest({ root: t.dir, pkg: 'backend', coverage: true, spawn });
    assert.equal(r.thresholdsFailed, true);
    assert.equal(r.error, undefined);
    assert.equal(r.exitCode, 1);
  } finally { t.cleanup(); }
});

test('runVitest: a non-zero exit with no failed files and no coverage message is an error', () => {
  const t = tempRoot();
  try {
    const spawn = fakeSpawn({ status: 1, signal: null, error: undefined, stdout: '', stderr: 'Error: config broke' }, okReport);
    const r = runVitest({ root: t.dir, pkg: 'backend', coverage: true, spawn });
    assert.equal(r.thresholdsFailed, false);
    assert.match(r.error, /^vitest exited 1 with no failed tests \(unhandled error\?\): .*Error: config broke/);
  } finally { t.cleanup(); }
});

test('runVitest: a timeout names ETIMEDOUT in the error', () => {
  const t = tempRoot();
  try {
    const err = Object.assign(new Error('spawnSync npx ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const r = runVitest({ root: t.dir, pkg: 'backend', spawn: fakeSpawn({ status: null, signal: 'SIGTERM', error: err, stdout: '', stderr: '' }) });
    assert.equal(r.error, 'vitest timed out (ETIMEDOUT)');
  } finally { t.cleanup(); }
});

test('runVitest: a signal kill names the signal in the error', () => {
  const t = tempRoot();
  try {
    const r = runVitest({ root: t.dir, pkg: 'backend', spawn: fakeSpawn({ status: null, signal: 'SIGKILL', error: undefined, stdout: '', stderr: '' }, okReport) });
    assert.equal(r.error, 'vitest killed by SIGKILL');
  } finally { t.cleanup(); }
});

test('runVitest: a truncated report returns an error instead of throwing', () => {
  const t = tempRoot();
  try {
    const r = runVitest({ root: t.dir, pkg: 'backend', spawn: fakeSpawn({ status: 1, signal: null, error: undefined, stdout: '', stderr: '' }, '{"numPassed') });
    assert.equal(r.error, 'vitest report is not valid JSON');
    assert.deepEqual(r.ranFiles, []);
  } finally { t.cleanup(); }
});

test('real vitest: a nonexistent test file is never reported as ranFiles', {
  skip: !existsSync(path.join(REPO, 'backend', 'node_modules')) && 'backend dependencies not installed',
}, () => {
  const r = runVitest({ root: REPO, pkg: 'backend', files: ['backend/tests/doesnotexist.test.ts'] });
  assert.deepEqual(r.ranFiles, []);
});

test('testEnv scrubs tokens, runner command files and ACTIONS_ vars', async () => {
  const { testEnv } = await import('../verify.js');
  const env = testEnv({
    PATH: '/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'x', ANTHROPIC_API_KEY: 'x', GITHUB_ENV: 'f', GITHUB_PATH: 'f',
    GITHUB_OUTPUT: 'f', GITHUB_STEP_SUMMARY: 'f', GITHUB_STATE: 'f', ACTIONS_RUNTIME_TOKEN: 'x', GITHUB_REPOSITORY: 'o/r',
  });
  assert.deepEqual(env, { PATH: '/bin', GITHUB_REPOSITORY: 'o/r', CI: 'true' });
});
