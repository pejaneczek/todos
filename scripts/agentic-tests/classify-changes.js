// scripts/agentic-tests/classify-changes.js
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expectedTestPath, isSafeRelative, isTestPath, packageOf } from './paths.js';

const ELIGIBLE = { backend: /^backend\/src\/.+\.ts$/, frontend: /^frontend\/src\/.+\.tsx?$/ };
const SAFE_CHARS = /^[A-Za-z0-9._/-]+$/;
const SKIP_RULES = [
  [/\.d\.ts$|(^|\/)types\.ts$|\.types\.ts$/, 'type declarations only'],
  [/(^|\/)index\.ts$/, 're-export barrel'],
  [/\.stories\.tsx$/, 'storybook story'],
  [/^backend\/src\/generated\//, 'generated code'],
  [/^backend\/src\/main\.ts$|^frontend\/src\/main\.tsx$/, 'process bootstrap'],
  [/^frontend\/src\/design-system\//, 'design system (excluded from coverage)'],
  [/^frontend\/src\/features\/todos\/api\/queryKeys\.ts$|^frontend\/src\/lib\/queryClient\.ts$|\.constants\.ts$|(^|\/)constants\.tsx?$/, 'excluded from coverage'],
];

export function classify(files, { root = process.cwd(), exists = (p) => existsSync(path.join(root, p)) } = {}) {
  const result = { backend: [], frontend: [], skipped: [], existingTests: {} };
  for (const file of [...new Set(files)].sort()) {
    if (!isSafeRelative(file) || !SAFE_CHARS.test(file)) { result.skipped.push({ file, reason: 'unsupported characters in path' }); continue; }
    if (isTestPath(file) || /\.test\.tsx?$/.test(file)) { result.skipped.push({ file, reason: 'test file' }); continue; }
    const pkg = packageOf(file);
    if (!pkg || !ELIGIBLE[pkg].test(file)) { result.skipped.push({ file, reason: 'not application source' }); continue; }
    const rule = SKIP_RULES.find(([re]) => re.test(file));
    if (rule) { result.skipped.push({ file, reason: rule[1] }); continue; }
    result[pkg].push(file);
    const test = expectedTestPath(file);
    if (exists(test)) result.existingTests[file] = test;
  }
  return result;
}

export const targetsOf = (c) => [...c.backend, ...c.frontend];
export const targetCount = (c) => targetsOf(c).length;

export function filterByCoverage(c, files, min = { lines: 90, branches: 80 }) {
  const next = { ...c, backend: [], frontend: [], skipped: [...c.skipped] };
  for (const pkg of ['backend', 'frontend']) {
    for (const file of c[pkg]) {
      const cov = files[file];
      if (cov && cov.lines >= min.lines && cov.branches >= min.branches) {
        next.skipped.push({ file, reason: `already well covered (lines ${cov.lines}%, branches ${cov.branches}%)` });
      } else next[pkg].push(file);
    }
  }
  return next;
}
