// scripts/agentic-tests/guard.js
// Nothing here follows symlinks: every path is checked component by component with lstat,
// and a symlink or non-directory ancestor is treated as a non-regular entry, never traversed.
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { git, listRepoFiles } from './git.js';
import { isTestPath } from './paths.js';

const UNREADABLE = { type: 'unreadable', content: null, link: null };
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };

// Entry describing the final path component itself (never follows a symlink).
function leafEntry(abs) {
  const st = lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink()) {
    try { return { type: 'symlink', content: null, link: readlinkSync(abs) }; } catch { return UNREADABLE; }
  }
  if (st.isDirectory()) return { type: 'dir', content: null, link: null };
  if (!st.isFile()) return { type: 'other', content: null, link: null };
  try { return { type: 'file', content: readFileSync(abs), link: null }; } catch { return UNREADABLE; }
}

// Entry for base/rel; an ancestor that is a symlink or not a directory makes the path non-regular.
function entryAt(base, rel) {
  const parts = rel.split('/');
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return null;
    if (!st.isDirectory()) return { type: 'other', content: null, link: null };
  }
  return leafEntry(path.join(dir, parts.at(-1)));
}

function ancestorsClean(base, rel) {
  const parts = rel.split('/');
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (st && !st.isDirectory()) return false;
  }
  return true;
}

// Removes base/rel. A symlink or file standing in for an ancestor is removed itself, never followed.
function removeAt(base, rel) {
  const parts = rel.split('/');
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (!st) return;
    if (!st.isDirectory()) { rmSync(dir, { recursive: true, force: true }); return; }
  }
  rmSync(path.join(dir, parts.at(-1)), { recursive: true, force: true });
}

// Makes every ancestor of base/rel a real directory, replacing symlinks or files in the way.
function prepareParents(base, rel) {
  const parts = rel.split('/');
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const st = lstatOrNull(dir);
    if (st && st.isDirectory()) continue;
    if (st) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
  }
}

function writeEntryAt(base, rel, s) {
  removeAt(base, rel);
  prepareParents(base, rel);
  const abs = path.join(base, rel);
  if (s.type === 'file') writeFileSync(abs, s.content);
  else if (s.type === 'symlink') symlinkSync(s.link, abs);
  else if (s.type === 'dir') mkdirSync(abs);
}

function sameEntry(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'symlink') return a.link === b.link;
  if (a.type === 'file') return a.content.equals(b.content);
  return true;
}

const commonDir = (root) => path.resolve(root, git(['rev-parse', '--git-common-dir'], { cwd: root }));

// Maps a snapshot key to {base, rel}. Git control files are absolute keys under the common git dir.
function locate(common, root, file) {
  if (!path.isAbsolute(file)) return { base: root, rel: file };
  const rel = path.relative(common, file);
  if (rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel)) return { base: common, rel };
  return { base: path.dirname(file), rel: path.basename(file) };
}

function currentEntries(root) {
  const out = new Map();
  for (const rel of listRepoFiles(root)) {
    const e = entryAt(root, rel);
    if (e) out.set(rel, e);
  }
  return out;
}

function controlFiles(root) {
  const at = (what) => path.resolve(root, git(['rev-parse', '--git-path', what], { cwd: root }));
  const out = [at('info/exclude'), at('config'), at('hooks')];
  const walk = (dir) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const p = path.join(dir, name);
      out.push(p);
      if (lstatOrNull(p)?.isDirectory()) walk(p);
    }
  };
  if (lstatOrNull(out[2])?.isDirectory()) walk(out[2]);
  return out;
}

function controlEntries(root) {
  const common = commonDir(root);
  const out = new Map();
  for (const abs of controlFiles(root)) {
    const { base, rel } = locate(common, root, abs);
    const e = entryAt(base, rel);
    if (e) out.set(abs, e);
  }
  return out;
}

export function snapshot(root) {
  const snap = new Map(currentEntries(root));
  for (const [abs, e] of controlEntries(root)) snap.set(abs, e);
  return snap;
}

export function findViolations(root, snap) {
  const violations = [];
  const cur = currentEntries(root);
  for (const [file, s] of snap) {
    if (path.isAbsolute(file) || s.type === 'unreadable') continue;
    const c = cur.get(file);
    if (!c) { if (!isTestPath(file)) violations.push({ file, kind: 'deleted' }); continue; }
    if (c.type === 'unreadable') { violations.push({ file, kind: 'unreadable' }); continue; }
    if (c.type !== 'file') { if (!sameEntry(s, c)) violations.push({ file, kind: 'non-regular' }); continue; }
    if (!isTestPath(file) && !sameEntry(s, c)) violations.push({ file, kind: 'modified' });
  }
  for (const [file, c] of cur) {
    if (snap.has(file)) continue;
    if (c.type === 'file') { if (!isTestPath(file)) violations.push({ file, kind: 'created' }); }
    else if (c.type === 'unreadable') violations.push({ file, kind: 'unreadable' });
    else violations.push({ file, kind: 'non-regular' });
  }
  const ctl = controlEntries(root);
  for (const [abs, s] of snap) {
    if (!path.isAbsolute(abs) || s.type === 'unreadable') continue;
    const c = ctl.get(abs);
    if (!c || !sameEntry(s, c)) violations.push({ file: abs, kind: 'git-control' });
  }
  for (const abs of ctl.keys()) if (!snap.has(abs)) violations.push({ file: abs, kind: 'git-control' });
  return violations;
}

export function restore(root, snap, violations) {
  const common = commonDir(root);
  const refs = violations.map((v) => ({ file: v.file, ...locate(common, root, v.file) }));
  const depth = (r) => r.rel.split('/').length;
  // Created paths go first, deepest first, so a replaced directory is cleared before its parent is rewritten.
  for (const r of refs.filter((x) => !snap.has(x.file)).sort((a, b) => depth(b) - depth(a))) removeAt(r.base, r.rel);
  // Then snapshot entries, shallowest first, so a directory is recreated before the files inside it.
  for (const r of refs.filter((x) => snap.has(x.file)).sort((a, b) => depth(a) - depth(b))) writeEntryAt(r.base, r.rel, snap.get(r.file));
}

// Empty files the Claude Code Bash sandbox (bubblewrap) creates at the repo root as bind-mount targets
// for write-protected paths, and lists in .git/info/exclude. They are still removed, just not violations.
const SANDBOX_PLACEHOLDERS = new Set([
  '.env.development', '.env.development.local', '.env.local', '.env.production', '.env.production.local',
  '.env.test', '.env.test.local', '.gitmodules', '.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

function isSandboxArtifact(root, snap, v) {
  if (v.kind === 'created') {
    if (!SANDBOX_PLACEHOLDERS.has(v.file)) return false;
    const c = entryAt(root, v.file);
    return c?.type === 'file' && c.content.length === 0;
  }
  if (v.kind !== 'git-control') return false;
  const exclude = path.resolve(root, git(['rev-parse', '--git-path', 'info/exclude'], { cwd: root }));
  if (v.file !== exclude) return false;
  const s = snap.get(v.file);
  if (s && s.type !== 'file') return false;
  const c = leafEntry(v.file);
  if (c?.type !== 'file') return false;
  // Only appended lines are allowed, and each must be blank, a comment or a placeholder name.
  const before = s ? s.content : Buffer.alloc(0);
  if (!c.content.subarray(0, before.length).equals(before)) return false;
  return c.content.subarray(before.length).toString('utf8').split('\n').every((line) => {
    const t = line.trim().replace(/^\//, '');
    return t === '' || t.startsWith('#') || SANDBOX_PLACEHOLDERS.has(t);
  });
}

export function enforce(root, snap) {
  const seen = new Map();
  for (let i = 0; i < 5; i += 1) {
    const v = findViolations(root, snap);
    if (v.length === 0) break;
    for (const x of v) if (!isSandboxArtifact(root, snap, x)) seen.set(`${x.kind}:${x.file}`, x);
    restore(root, snap, v);
  }
  return [...seen.values()];
}

export function changedTestFiles(root, snap) {
  const cur = currentEntries(root);
  const out = { created: [], modified: [], deleted: [] };
  for (const file of [...cur.keys()].sort()) {
    const c = cur.get(file);
    if (!isTestPath(file) || c.type !== 'file') continue;
    const s = snap.get(file);
    if (!s) out.created.push(file);
    else if (!sameEntry(s, c)) out.modified.push(file);
  }
  for (const file of snap.keys()) if (!path.isAbsolute(file) && isTestPath(file) && !cur.has(file)) out.deleted.push(file);
  return out;
}

export function rejectFile(root, snap, file, kind, keepDir) {
  if (kind === 'modified' || kind === 'deleted') { writeEntryAt(root, file, snap.get(file)); return; }
  if (keepDir && ancestorsClean(root, file) && lstatOrNull(path.join(root, file))) {
    const dest = path.join(keepDir, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(path.join(root, file), dest);
  } else removeAt(root, file);
}

// Every path `git apply` would touch, as git itself computes it (catches prefix tricks the grammar misses).
export function patchPaths(root, patchFile) {
  const out = git(['apply', '--numstat', '-z', '--', patchFile], { cwd: root });
  const toks = out.split('\0');
  const paths = [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (!t) continue;
    const m = t.match(/^[^\t]*\t[^\t]*\t(.*)$/s);
    if (!m) throw new Error('unparseable git apply --numstat output');
    if (m[1] === '') { paths.push(toks[i + 1], toks[i + 2]); i += 2; } else paths.push(m[1]);
  }
  return paths.filter(Boolean);
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_RE = /^diff --git a\/(\S+) b\/(\S+)$/;
const INDEX_RE = /^index [0-9a-f]+\.\.[0-9a-f]+(?: \d{6})?$/;
const SIMILARITY_RE = /^(?:dis)?similarity index \d+%$/;
const MODE_RE = /^(new file|deleted file|old|new) mode (\d+)$/;
const OK_MODES = new Set(['100644', '100755']);

// Strict grammar: any line not matching a known form is rejected, and hunk bodies are consumed by their counts.
export function patchViolations(patch) {
  if (patch.includes('\r')) return [{ file: '(crlf)', kind: 'crlf' }];
  const violations = [];
  const checkPath = (p) => { if (p !== '/dev/null' && !isTestPath(p)) violations.push({ file: p, kind: 'path' }); };
  const unparseable = (line) => { violations.push({ file: line.slice(0, 200), kind: 'unparseable' }); return violations; };
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let inSection = false;
  let hunk = null;
  for (const line of lines) {
    if (hunk) {
      if (line.startsWith('\\')) continue;
      const c = line[0];
      if (c === ' ') { hunk.old -= 1; hunk.new -= 1; }
      else if (c === '-') hunk.old -= 1;
      else if (c === '+') hunk.new -= 1;
      else return unparseable(line);
      if (hunk.old < 0 || hunk.new < 0) return unparseable(line);
      if (hunk.old === 0 && hunk.new === 0) hunk = null;
      continue;
    }
    let m;
    if (line.startsWith('diff --git ')) {
      if (!(m = line.match(DIFF_RE))) return unparseable(line);
      inSection = true;
      checkPath(m[1]);
      checkPath(m[2]);
      continue;
    }
    if (!inSection) return unparseable(line);
    if (line.startsWith('\\')) continue;
    if ((m = line.match(HUNK_RE))) {
      hunk = { old: m[2] === undefined ? 1 : Number(m[2]), new: m[4] === undefined ? 1 : Number(m[4]) };
      if (hunk.old === 0 && hunk.new === 0) hunk = null;
      continue;
    }
    if ((m = line.match(/^(---|\+\+\+) (.+)$/))) {
      const side = m[1] === '---' ? 'a' : 'b';
      if (m[2] === '/dev/null') continue;
      const p = m[2].match(new RegExp(`^${side}/(\\S+)$`));
      if (!p) return unparseable(line);
      checkPath(p[1]);
      continue;
    }
    if ((m = line.match(/^(?:rename|copy) (?:from|to) (.+)$/))) { checkPath(m[1]); continue; }
    if (SIMILARITY_RE.test(line) || INDEX_RE.test(line)) continue;
    if ((m = line.match(MODE_RE))) {
      if (m[1] === 'deleted file') { violations.push({ file: '(deletion)', kind: 'deletion' }); continue; }
      if (m[2] === '120000') violations.push({ file: '(symlink)', kind: 'symlink' });
      else if (!OK_MODES.has(m[2])) violations.push({ file: `(mode ${m[2]})`, kind: 'mode' });
      continue;
    }
    if (line === 'GIT binary patch' || /^Binary files .* differ$/.test(line)) { violations.push({ file: '(binary)', kind: 'binary' }); continue; }
    return unparseable(line);
  }
  return violations;
}

export function patchFileViolations(root, patchFile) {
  let text;
  try { text = readFileSync(patchFile, 'utf8'); } catch { return [{ file: '(patch)', kind: 'unparseable' }]; }
  const violations = patchViolations(text);
  let paths;
  try { paths = patchPaths(root, patchFile); } catch { return [...violations, { file: '(patch)', kind: 'unparseable' }]; }
  for (const p of paths) if (!isTestPath(p)) violations.push({ file: p, kind: 'path' });
  return violations;
}
