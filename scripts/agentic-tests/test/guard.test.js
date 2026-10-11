// scripts/agentic-tests/test/guard.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, lstatSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from '../git.js';
import {
  snapshot, findViolations, restore, changedTestFiles, rejectFile, patchViolations, patchFileViolations, enforce,
} from '../guard.js';

const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });
const tempDir = (prefix) => { const d = mkdtempSync(path.join(tmpdir(), prefix)); tmpDirs.push(d); return d; };

function makeRepo() {
  const dir = tempDir('guard-');
  git(['init', '-q'], { cwd: dir });
  const files = {
    '.gitignore': 'node_modules/\n',
    'backend/src/a.ts': 'export const a = 1;\n',
    'backend/tests/a.test.ts': "it('a', () => {});\n",
    'scripts/agentic-tests/publish.js': 'export {};\n',
  };
  for (const [f, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), c); }
  git(['add', '-A'], { cwd: dir });
  return dir;
}

test('detects and restores modified, deleted and created non-test files', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, 'backend/src/a.ts'), 'pwned');
  rmSync(path.join(dir, 'scripts/agentic-tests/publish.js'));
  writeFileSync(path.join(dir, 'backend/src/evil.ts'), 'x');
  writeFileSync(path.join(dir, 'backend/tests/a.test.ts'), 'changed test is fine');
  mkdirSync(path.join(dir, 'node_modules'));
  writeFileSync(path.join(dir, 'node_modules/ignored.js'), 'ignored');
  const v = findViolations(dir, snap);
  assert.deepEqual(v.map((x) => `${x.kind}:${x.file}`).sort(), [
    'created:backend/src/evil.ts', 'deleted:scripts/agentic-tests/publish.js', 'modified:backend/src/a.ts',
  ]);
  restore(dir, snap, v);
  assert.equal(readFileSync(path.join(dir, 'backend/src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.equal(existsSync(path.join(dir, 'scripts/agentic-tests/publish.js')), true);
  assert.equal(existsSync(path.join(dir, 'backend/src/evil.ts')), false);
  assert.deepEqual(findViolations(dir, snap), []);
});

test('reports created, modified and deleted test files and rejects them', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, 'backend/tests/a.test.ts'), 'modified');
  writeFileSync(path.join(dir, 'backend/tests/b.test.ts'), 'created');
  assert.deepEqual(changedTestFiles(dir, snap), { created: ['backend/tests/b.test.ts'], modified: ['backend/tests/a.test.ts'], deleted: [] });
  const keep = path.join(dir, '.rejected');
  rejectFile(dir, snap, 'backend/tests/b.test.ts', 'created', keep);
  rejectFile(dir, snap, 'backend/tests/a.test.ts', 'modified');
  assert.equal(existsSync(path.join(keep, 'backend/tests/b.test.ts')), true);
  assert.equal(readFileSync(path.join(dir, 'backend/tests/a.test.ts'), 'utf8'), "it('a', () => {});\n");
});

test('rejectFile restores a deleted test file', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  rmSync(path.join(dir, 'backend/tests/a.test.ts'));
  assert.deepEqual(changedTestFiles(dir, snap).deleted, ['backend/tests/a.test.ts']);
  rejectFile(dir, snap, 'backend/tests/a.test.ts', 'deleted');
  assert.equal(readFileSync(path.join(dir, 'backend/tests/a.test.ts'), 'utf8'), "it('a', () => {});\n");
});

test('patchViolations accepts test-only patches', () => {
  const ok = [
    'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts',
    'new file mode 100644', '--- /dev/null', '+++ b/backend/tests/a.test.ts', '@@ -0,0 +1 @@', '+x',
  ].join('\n');
  assert.deepEqual(patchViolations(ok), []);
});

test('patchViolations rejects non-test, traversal, quoted, rename, symlink, binary and deletions', () => {
  const kinds = (p) => patchViolations(p).map((v) => v.kind);
  assert.deepEqual(kinds('diff --git a/backend/src/a.ts b/backend/src/a.ts\n--- a/backend/src/a.ts\n+++ b/backend/src/a.ts'), ['path', 'path', 'path', 'path']);
  assert.ok(kinds('diff --git a/backend/tests/../src/a.ts b/backend/tests/../src/a.ts').includes('path'));
  assert.deepEqual(kinds('diff --git "a/backend/tests/a b.test.ts" "b/backend/tests/a b.test.ts"'), ['unparseable']);
  assert.ok(kinds('diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\nrename from backend/src/x.ts\nrename to backend/tests/a.test.ts').includes('path'));
  assert.ok(kinds('diff --git a/backend/tests/l.ts b/backend/tests/l.ts\nnew file mode 120000').includes('symlink'));
  assert.ok(kinds('diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\nGIT binary patch').includes('binary'));
  assert.ok(kinds('diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\ndeleted file mode 100644').includes('deletion'));
});

test('bypass: traditional diff without a git header and with a tab-separated timestamp is rejected', () => {
  const p = '--- a/backend/src/a.ts\t2020-01-01 00:00:00\n+++ b/backend/tests/a.test.ts\t2020-01-01 00:00:00\n@@ -1 +1 @@\n-x\n+y\n';
  assert.notEqual(patchViolations(p).length, 0);
});

test('bypass: CRLF on ---/+++ lines is rejected', () => {
  const p = 'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\r\n--- a/backend/tests/a.test.ts\r\n+++ b/backend/tests/a.test.ts\r\n@@ -1 +1 @@\r\n-x\r\n+y\r\n';
  assert.ok(patchViolations(p).some((v) => v.kind === 'crlf'));
});

test('bypass: a +++ line without the b/ prefix is rejected', () => {
  const p = 'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts\n--- a/backend/tests/a.test.ts\n+++ backend/tests/evil.ts\n@@ -0,0 +1 @@\n+x\n';
  assert.notEqual(patchViolations(p).length, 0);
});

test('bypass: gitlink mode 160000 is rejected', () => {
  const p = 'diff --git a/backend/tests/sub b/backend/tests/sub\nnew file mode 160000\n';
  assert.ok(patchViolations(p).some((v) => v.kind === 'mode'));
});

test('hunk content lines that look like headers are not violations', () => {
  const p = [
    'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts',
    '--- a/backend/tests/a.test.ts',
    '+++ b/backend/tests/a.test.ts',
    '@@ -1,2 +1,2 @@',
    '--- x',
    '++ y',
    ' keep',
    '',
  ].join('\n');
  assert.deepEqual(patchViolations(p), []);
});

test('patchFileViolations rejects a prefix-less +++ that git apply would write outside the test tree', () => {
  const dir = makeRepo();
  const patchDir = tempDir('guard-patch-');
  const patchFile = path.join(patchDir, 'evil.patch');
  writeFileSync(patchFile, '--- a/backend/tests/a.test.ts\n+++ backend/tests/evil.ts\n@@ -0,0 +1 @@\n+x\n');
  const v = patchFileViolations(dir, patchFile);
  assert.ok(v.some((x) => x.kind === 'path' && x.file === 'tests/evil.ts'), JSON.stringify(v));
});

test('patchFileViolations accepts a valid test-only patch', () => {
  const dir = makeRepo();
  const patchDir = tempDir('guard-patch-');
  const patchFile = path.join(patchDir, 'ok.patch');
  writeFileSync(patchFile, 'diff --git a/backend/tests/new.test.ts b/backend/tests/new.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/backend/tests/new.test.ts\n@@ -0,0 +1 @@\n+x\n');
  assert.deepEqual(patchFileViolations(dir, patchFile), []);
});

test('a non-test file replaced by a symlink to an outside file is flagged and restored without touching the target', () => {
  const dir = makeRepo();
  const outsideDir = tempDir('guard-outside-');
  const outside = path.join(outsideDir, 'target.txt');
  writeFileSync(outside, 'outside original');
  const snap = snapshot(dir);
  rmSync(path.join(dir, 'backend/src/a.ts'));
  symlinkSync(outside, path.join(dir, 'backend/src/a.ts'));
  const v = findViolations(dir, snap);
  assert.ok(v.some((x) => x.kind === 'non-regular' && x.file === 'backend/src/a.ts'), JSON.stringify(v));
  restore(dir, snap, v);
  assert.equal(readFileSync(outside, 'utf8'), 'outside original');
  assert.equal(lstatSync(path.join(dir, 'backend/src/a.ts')).isFile(), true);
  assert.equal(readFileSync(path.join(dir, 'backend/src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.deepEqual(findViolations(dir, snap), []);
});

test('a symlink to identical content is still a violation', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  const copy = path.join(tempDir('guard-same-'), 'copy.ts');
  writeFileSync(copy, 'export const a = 1;\n');
  rmSync(path.join(dir, 'backend/src/a.ts'));
  symlinkSync(copy, path.join(dir, 'backend/src/a.ts'));
  assert.ok(findViolations(dir, snap).some((x) => x.kind === 'non-regular' && x.file === 'backend/src/a.ts'));
});

test('a symlinked parent directory is never followed on restore', () => {
  const dir = makeRepo();
  const outsideDir = tempDir('guard-outdir-');
  writeFileSync(path.join(outsideDir, 'a.ts'), 'outside');
  const snap = snapshot(dir);
  rmSync(path.join(dir, 'backend/src'), { recursive: true, force: true });
  symlinkSync(outsideDir, path.join(dir, 'backend/src'));
  const v = findViolations(dir, snap);
  assert.ok(v.some((x) => x.kind === 'non-regular'), JSON.stringify(v));
  restore(dir, snap, v);
  assert.equal(readFileSync(path.join(outsideDir, 'a.ts'), 'utf8'), 'outside');
  assert.equal(readFileSync(path.join(dir, 'backend/src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.equal(lstatSync(path.join(dir, 'backend/src')).isDirectory(), true);
});

test('a test path created as a symlink is reported as non-regular and excluded from created', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  const outsideDir = tempDir('guard-link-');
  const target = path.join(outsideDir, 't.ts');
  writeFileSync(target, 'x');
  symlinkSync(target, path.join(dir, 'backend/tests/link.test.ts'));
  const v = findViolations(dir, snap);
  assert.ok(v.some((x) => x.kind === 'non-regular' && x.file === 'backend/tests/link.test.ts'), JSON.stringify(v));
  assert.deepEqual(changedTestFiles(dir, snap), { created: [], modified: [], deleted: [] });
});

test('a non-test file replaced by a directory is flagged, does not throw, and restore recreates the file', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  rmSync(path.join(dir, 'backend/src/a.ts'));
  mkdirSync(path.join(dir, 'backend/src/a.ts'));
  writeFileSync(path.join(dir, 'backend/src/a.ts/inner.ts'), 'x');
  let v;
  assert.doesNotThrow(() => { v = findViolations(dir, snap); });
  assert.ok(v.some((x) => x.kind === 'non-regular' && x.file === 'backend/src/a.ts'), JSON.stringify(v));
  restore(dir, snap, v);
  assert.equal(readFileSync(path.join(dir, 'backend/src/a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.deepEqual(findViolations(dir, snap), []);
});

test('an unreadable file is reported without throwing and restore repairs it', { skip: process.getuid?.() === 0 }, () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  chmodSync(path.join(dir, 'backend/src/a.ts'), 0o000);
  let v;
  assert.doesNotThrow(() => { v = findViolations(dir, snap); });
  assert.ok(v.some((x) => x.kind === 'unreadable' && x.file === 'backend/src/a.ts'), JSON.stringify(v));
  restore(dir, snap, v);
  assert.equal(readFileSync(path.join(dir, 'backend/src/a.ts'), 'utf8'), 'export const a = 1;\n');
});

test('enforce removes a file hidden by a nested .gitignore, along with the .gitignore', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, 'backend/src/.gitignore'), 'evil.ts\n');
  writeFileSync(path.join(dir, 'backend/src/evil.ts'), 'x');
  const reported = enforce(dir, snap);
  assert.ok(reported.some((x) => x.file === 'backend/src/.gitignore'));
  assert.ok(reported.some((x) => x.file === 'backend/src/evil.ts'));
  assert.equal(existsSync(path.join(dir, 'backend/src/.gitignore')), false);
  assert.equal(existsSync(path.join(dir, 'backend/src/evil.ts')), false);
  assert.deepEqual(findViolations(dir, snap), []);
});

test('a file hidden by .git/info/exclude is reported as created and removed, and the exclude restored', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, '.git/info/exclude'), 'hidden.ts\n', { flag: 'a' });
  writeFileSync(path.join(dir, 'backend/src/hidden.ts'), 'x');
  const before = snap.get(path.resolve(dir, '.git/info/exclude')).content;
  const reported = enforce(dir, snap);
  assert.ok(reported.some((x) => x.kind === 'created' && x.file === 'backend/src/hidden.ts'), JSON.stringify(reported));
  assert.equal(existsSync(path.join(dir, 'backend/src/hidden.ts')), false);
  assert.deepEqual(readFileSync(path.join(dir, '.git/info/exclude')), before);
  assert.deepEqual(findViolations(dir, snap), []);
});

test('empty sandbox placeholders and their info/exclude entries are removed without being reported', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  const exclude = path.join(dir, '.git/info/exclude');
  const before = readFileSync(exclude);
  for (const f of ['.npmrc', '.env.local', 'yarn.lock']) writeFileSync(path.join(dir, f), '');
  writeFileSync(exclude, 'rewritten by the sandbox\n/.npmrc\n.env.local\nyarn.lock');
  assert.deepEqual(enforce(dir, snap), []);
  for (const f of ['.npmrc', '.env.local', 'yarn.lock']) assert.equal(existsSync(path.join(dir, f)), false);
  assert.deepEqual(readFileSync(exclude), before);
});

test('a placeholder name with content is still a violation, even when excluded', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, '.npmrc'), 'registry=https://evil.example\n');
  writeFileSync(path.join(dir, '.git/info/exclude'), '.npmrc\n', { flag: 'a' });
  const reported = enforce(dir, snap);
  assert.ok(reported.some((x) => x.kind === 'created' && x.file === '.npmrc'), JSON.stringify(reported));
  assert.equal(existsSync(path.join(dir, '.npmrc')), false);
});

test('a placeholder name below the repo root is a violation even when empty', () => {
  const dir = makeRepo();
  const snap = snapshot(dir);
  writeFileSync(path.join(dir, 'backend/.npmrc'), '');
  assert.ok(enforce(dir, snap).some((x) => x.kind === 'created' && x.file === 'backend/.npmrc'));
});
