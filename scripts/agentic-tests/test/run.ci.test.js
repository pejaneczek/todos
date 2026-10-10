import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hermeticCopy } from './hermetic-copy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function copyRepo() {
  const dir = hermeticCopy(ROOT, 'agentic-ci-');
  dirs.push(dir);
  return dir;
}

const run = (dir, args, env = {}) =>
  spawnSync('node', [path.join(dir, 'scripts/agentic-tests/run.js'), '--ci', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const readReport = (dir) => JSON.parse(readFileSync(path.join(dir, '.agentic-tests/report.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const emptyClassification = { backend: [], frontend: [], skipped: [], existingTests: {} };
const baseState = (status) => ({
  status, context: { mode: 'ci' }, classification: emptyClassification, agent: null, guard: { violations: [] },
  changes: { created: [], modified: [], deleted: [] }, accepted: [], rejected: [], verification: {}, coverage: { before: {}, after: {} },
});

test('ciVerify: a forged state.json is rejected as an invalid artifact', () => {
  const dir = copyRepo();
  const art = path.join(dir, 'art');
  mkdirSync(art);
  writeFileSync(path.join(art, 'state.json'), JSON.stringify({ ...baseState('tests-ready'), accepted: ['backend/tests/x.test.ts'] }));
  const r = run(dir, ['--stage', 'verify', '--artifacts', art]);
  assert.equal(r.status, 0, r.stderr);
  const report = readReport(dir);
  assert.equal(report.status, 'guard-violation');
  assert.deepEqual(report.guard.violations, [{ file: 'state.json', kind: 'invalid-artifact' }]);
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(readdirSync(path.join(dir, '.agentic-tests/publish/files')), []);
});

test('ciVerify: a patch touching production code is a guard violation and is not applied', () => {
  const dir = copyRepo();
  const factory = path.join(dir, 'backend/src/factory.ts');
  const original = readFileSync(factory, 'utf8');
  writeFileSync(factory, `${original}\n// evil\n`);
  const patch = spawnSync('git', ['diff', '--', 'backend/src/factory.ts'], { cwd: dir, encoding: 'utf8' }).stdout;
  writeFileSync(factory, original);
  const art = path.join(dir, 'art');
  mkdirSync(art);
  writeFileSync(path.join(art, 'state.json'), JSON.stringify(baseState('agent-done')));
  writeFileSync(path.join(art, 'tests.patch'), patch);
  const r = run(dir, ['--stage', 'verify', '--artifacts', art]);
  assert.equal(r.status, 0, r.stderr);
  const report = readReport(dir);
  assert.equal(report.status, 'guard-violation');
  assert.ok(report.guard.violations.some((v) => v.file === 'backend/src/factory.ts'));
  assert.equal(readFileSync(factory, 'utf8'), original);
});

const HEAD = 'a'.repeat(40);
function publishSetup({ tamper = false } = {}) {
  const dir = copyRepo();
  const bundle = path.join(dir, 'bundle');
  const rel = 'backend/tests/x.test.ts';
  const content = Buffer.from("import { it } from 'vitest';\nit('x', () => {});\n");
  mkdirSync(path.join(bundle, 'files/backend/tests'), { recursive: true });
  writeFileSync(path.join(bundle, 'files', rel), tamper ? Buffer.from('tampered') : content);
  writeFileSync(path.join(bundle, 'report.json'), JSON.stringify({ ...baseState('tests-ready'), accepted: [rel], acceptedHashes: { [rel]: sha(content) } }));
  const gh = path.join(dir, 'scripts/agentic-tests/test/fixtures/fake-gh.js');
  chmodSync(gh, 0o755);
  const log = path.join(dir, 'gh.log');
  const env = {
    AGENTIC_TESTS_GH_BIN: gh, GH_LOG: log, FAKE_REF_SHA: HEAD,
    EXPECTED_HEAD: HEAD, HEAD_REF: 'feature/x', PR_NUMBER: '7', GITHUB_REPOSITORY: 'o/r',
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, bundle, env, calls };
}

test('ciPublish: a file that does not match acceptedHashes fails without committing', () => {
  const { dir, bundle, env, calls } = publishSetup({ tamper: true });
  const r = run(dir, ['--stage', 'publish', '--artifacts', bundle], env);
  assert.equal(r.status, 1);
  const report = readReport(dir);
  assert.equal(report.status, 'publish-failed');
  assert.ok(report.commit.error);
  const all = calls().map((c) => c.argv.join(' '));
  assert.ok(!all.some((a) => a.includes('git/blobs') || a.includes('git/refs') || a.includes('git/trees')));
  assert.ok(all.some((a) => a.includes('/comments')));
});

test('ciPublish: a valid bundle is committed without force', () => {
  const { dir, bundle, env, calls } = publishSetup();
  const r = run(dir, ['--stage', 'publish', '--artifacts', bundle], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readReport(dir).status, 'committed');
  const patch = calls().find((c) => c.argv.includes('PATCH') && c.argv.some((a) => a.includes('git/refs/heads/')));
  assert.equal(JSON.parse(patch.stdin).force, false);
});

test('ciPublish: forged verification, coverage and commit fields in the bundle never reach the comment', () => {
  const { dir, bundle, env, calls } = publishSetup();
  const forged = {
    ...baseState('no-changes'),
    verification: { '[x](http://evil)': { passed: '<b>1</b>', failed: 0 }, backend: { passed: 2, failed: 0, total: 2, thresholdsFailed: false, extra: 'x' } },
    coverage: { before: 'bad', after: {} },
    commit: { status: 'committed', sha: 'deadbeefdeadbeef' },
    accepted: [],
    acceptedHashes: {},
  };
  writeFileSync(path.join(bundle, 'report.json'), JSON.stringify(forged));
  const r = run(dir, ['--stage', 'publish', '--artifacts', bundle], env);
  assert.equal(r.status, 0, r.stderr);
  const post = calls().find((c) => c.argv.includes('POST') && c.argv.some((a) => a.endsWith('/comments')));
  const { body } = JSON.parse(post.stdin);
  assert.ok(!body.includes('](http'), body);
  assert.ok(!body.includes('<b>'), body);
  assert.ok(!body.includes('evil'), body);
  assert.ok(!body.includes('deadbee'), body);
  assert.ok(body.includes('| backend | 2 | 0 |'), body);
  const published = readReport(dir);
  assert.deepEqual(Object.keys(published.verification), ['backend']);
  assert.equal(published.commit, undefined);
  assert.deepEqual(published.coverage, { before: {}, after: {} });
});

test('argument validation', () => {
  const dir = copyRepo();
  assert.equal(run(dir, ['--stage', 'bogus']).status, 1);
  assert.equal(run(dir, ['--stage', 'verify']).status, 1);
  assert.equal(run(dir, ['--stage', 'publish']).status, 1);
  assert.equal(run(dir, ['--stage', 'agent', '--post']).status, 1);
});

test('existing-tests-failing survives the bundle round trip and is never committed', () => {
  const ready = existsSync(path.join(ROOT, 'backend/node_modules'));
  if (!ready) return;
  const mk = () => {
    const d = copyRepo();
    for (const pkg of ['backend', 'frontend']) symlinkSync(path.join(ROOT, pkg, 'node_modules'), path.join(d, pkg, 'node_modules'));
    return d;
  };
  const agentDir = mk();
  appendFileSync(path.join(agentDir, 'backend/src/api/health.ts'), '\n// touched\n');
  const fake = path.join(agentDir, 'scripts/agentic-tests/test/fixtures/fake-claude-good.js');
  chmodSync(fake, 0o755);
  const a = run(agentDir, ['--stage', 'agent', '--base', 'HEAD', '--skip-coverage'], { ANTHROPIC_API_KEY: 'x', AGENTIC_TESTS_CLAUDE_BIN: fake });
  assert.equal(a.status, 0, a.stderr);
  const dir = mk();
  writeFileSync(path.join(dir, 'backend/tests/zz-broken.test.ts'), "import { it, expect } from 'vitest';\nit('already broken', () => expect(1).toBe(2));\n");
  const v = run(dir, ['--stage', 'verify', '--artifacts', path.join(agentDir, '.agentic-tests'), '--skip-coverage']);
  assert.equal(v.status, 0, v.stderr);
  assert.equal(readReport(dir).status, 'existing-tests-failing');
  const bundle = path.join(dir, '.agentic-tests/publish');
  const gh = path.join(dir, 'scripts/agentic-tests/test/fixtures/fake-gh.js');
  chmodSync(gh, 0o755);
  const log = path.join(dir, 'gh.log');
  const p = run(dir, ['--stage', 'publish', '--artifacts', bundle], {
    AGENTIC_TESTS_GH_BIN: gh, GH_LOG: log, FAKE_REF_SHA: HEAD, EXPECTED_HEAD: HEAD, HEAD_REF: 'f', PR_NUMBER: '7', GITHUB_REPOSITORY: 'o/r',
  });
  assert.equal(p.status, 1);
  assert.equal(readReport(dir).status, 'existing-tests-failing');
  const all = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).argv.join(' '));
  assert.ok(all.some((x) => x.includes('/comments')));
  assert.ok(!all.some((x) => x.includes('git/blobs') || x.includes('git/refs')));
});
