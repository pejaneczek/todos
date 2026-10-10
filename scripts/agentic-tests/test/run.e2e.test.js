import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticCopy } from './hermetic-copy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ready = existsSync(path.join(ROOT, 'backend/node_modules'));

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function copyRepo() {
  const dir = hermeticCopy(ROOT, 'agentic-e2e-');
  dirs.push(dir);
  for (const pkg of ['backend', 'frontend']) symlinkSync(path.join(ROOT, pkg, 'node_modules'), path.join(dir, pkg, 'node_modules'));
  appendFileSync(path.join(dir, 'backend/src/api/health.ts'), '\n// touched by e2e test\n');
  return dir;
}

function run(dir, fake) {
  const bin = path.join(dir, 'scripts/agentic-tests/test/fixtures', fake);
  chmodSync(bin, 0o755);
  return spawnSync('node', [path.join(dir, 'scripts/agentic-tests/run.js'), '--base', 'HEAD', '--skip-coverage'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, AGENTIC_TESTS_CLAUDE_BIN: bin },
  });
}

const readReport = (dir) => JSON.parse(readFileSync(path.join(dir, '.agentic-tests/report.json'), 'utf8'));
const opts = { skip: !ready && 'run npm ci first', timeout: 300_000 };

test('good agent: test is verified and kept, report rendered', opts, () => {
  const dir = copyRepo();
  const r = run(dir, 'fake-claude-good.js');
  assert.equal(r.status, 0, r.stderr);
  const report = readReport(dir);
  assert.equal(report.status, 'tests-ready');
  assert.deepEqual(report.accepted, ['backend/tests/health.test.ts']);
  assert.equal(report.verification.backend.failed, 0);
  assert.ok(existsSync(path.join(dir, 'backend/tests/health.test.ts')));
  assert.match(readFileSync(path.join(dir, '.agentic-tests/report.md'), 'utf8'), /backend\/tests\/health.test.ts/);
});

test('evil agent: production edit restored, all output rejected, exit 1', opts, () => {
  const dir = copyRepo();
  const original = readFileSync(path.join(dir, 'backend/src/factory.ts'), 'utf8');
  const r = run(dir, 'fake-claude-evil.js');
  assert.equal(r.status, 1);
  const report = readReport(dir);
  assert.equal(report.status, 'guard-violation');
  assert.deepEqual(report.guard.violations, [{ file: 'backend/src/factory.ts', kind: 'modified' }]);
  assert.equal(readFileSync(path.join(dir, 'backend/src/factory.ts'), 'utf8'), original);
  assert.equal(existsSync(path.join(dir, 'backend/tests/health.test.ts')), false);
  assert.ok(existsSync(path.join(dir, '.agentic-tests/rejected/backend/tests/health.test.ts')));
});

test('failed agent run: output discarded, agent-failed, exit 0', opts, () => {
  const dir = copyRepo();
  const r = run(dir, 'fake-claude-fail.js');
  assert.equal(r.status, 0, r.stderr);
  const report = readReport(dir);
  assert.equal(report.status, 'agent-failed');
  assert.deepEqual(report.accepted, []);
  assert.equal(existsSync(path.join(dir, 'backend/tests/health.test.ts')), false);
  assert.ok(existsSync(path.join(dir, '.agentic-tests/rejected/backend/tests/health.test.ts')));
});

test('tampering agent: a test that rewrites a sibling during the run gets the sibling rejected', opts, () => {
  const dir = copyRepo();
  const r = run(dir, 'fake-claude-tamper.js');
  assert.equal(r.status, 0, r.stderr);
  const report = readReport(dir);
  assert.deepEqual(report.accepted, ['backend/tests/a.test.ts']);
  const rej = report.rejected.find((x) => x.file === 'backend/tests/b.test.ts');
  assert.equal(rej?.reason, 'modified during test execution');
  assert.equal(existsSync(path.join(dir, 'backend/tests/b.test.ts')), false);
});
