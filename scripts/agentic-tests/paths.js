// scripts/agentic-tests/paths.js
import path from 'node:path';

const TEST_PATH_PATTERNS = [
  /^backend\/tests\/.+\.ts$/,
  /^frontend\/src\/.+\.test\.tsx?$/,
  /^frontend\/src\/test\/.+\.tsx?$/,
];

export function isSafeRelative(p) {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\')
    && !p.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

export const isTestPath = (p) => isSafeRelative(p) && TEST_PATH_PATTERNS.some((re) => re.test(p));

export function packageOf(p) {
  if (p.startsWith('backend/')) return 'backend';
  if (p.startsWith('frontend/')) return 'frontend';
  return null;
}

export function expectedTestPath(src) {
  if (src.startsWith('backend/src/')) return `backend/tests/${path.posix.basename(src, '.ts')}.test.ts`;
  return src.replace(/\.(tsx?)$/, '.test.$1');
}
