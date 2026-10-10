// scripts/agentic-tests/git.js
import { spawnSync } from 'node:child_process';

export function git(args, { cwd = process.cwd(), allowFail = false } = {}) {
  // Poisoned repo config or hooks must never execute code inside our git calls.
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    const sub = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') ?? args[0];
    throw new Error(`git ${sub} failed: ${(r.stderr ?? '').trim()}`);
  }
  return (r.stdout ?? '').replace(/\n$/, '');
}

// A user or global excludes file must never hide repo files from the guard.
const NO_EXCLUDES = ['-c', 'core.excludesFile='];

export const zsplit = (s) => s.split('\0').filter(Boolean);
export const repoRoot = (cwd = process.cwd()) => git(['rev-parse', '--show-toplevel'], { cwd });
export const mergeBase = (root, ref) => git(['merge-base', '--end-of-options', ref, 'HEAD'], { cwd: root });

// Files changed since `base` in the working tree (committed + uncommitted + untracked), excluding deletions.
export function changedFiles(root, base) {
  const tracked = zsplit(git(['diff', '-z', '--name-only', '--diff-filter=ACMR', '--end-of-options', base], { cwd: root }));
  const untracked = untrackedFiles(root);
  return [...new Set([...tracked, ...untracked])];
}

export const untrackedFiles = (root) => zsplit(git([...NO_EXCLUDES, 'ls-files', '-z', '--others', '--exclude-standard'], { cwd: root }));
export const diffFor = (root, base, files) => (files.length ? git(['diff', '--end-of-options', base, '--', ...files], { cwd: root }) : '');
export const allSourceFiles = (root) => zsplit(git([...NO_EXCLUDES, 'ls-files', '-z', '-co', '--exclude-standard', '--', 'backend/src', 'frontend/src'], { cwd: root }));
export const listRepoFiles = (root) => zsplit(git([...NO_EXCLUDES, 'ls-files', '-z', '-co', '--exclude-standard'], { cwd: root }));
