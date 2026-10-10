// scripts/agentic-tests/verify.js
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { packageOf } from './paths.js';

const isTestFile = (f) => /\.test\.tsx?$/.test(f);
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

export function parseVitestJson(json, root) {
  const failedFiles = [];
  const failures = [];
  const ranFiles = [];
  for (const r of json.testResults ?? []) {
    const file = rel(root, r.name);
    ranFiles.push(file);
    if (r.status !== 'failed') continue;
    failedFiles.push(file);
    const failed = (r.assertionResults ?? []).filter((a) => a.status === 'failed');
    if (!failed.length) failures.push({ file, name: '(suite failed to run)', message: String(r.message ?? '').slice(0, 500) });
    for (const a of failed) failures.push({ file, name: a.fullName, message: String(a.failureMessages?.[0] ?? '').slice(0, 500) });
  }
  return { passed: json.numPassedTests ?? 0, failed: json.numFailedTests ?? 0, total: json.numTotalTests ?? 0, failedFiles, failures, ranFiles };
}

const COVERAGE_THRESHOLD = /Coverage for .* does not meet|ERROR: Coverage/i;

function describeAbort(r) {
  if (r.error?.code === 'ETIMEDOUT') return 'vitest timed out (ETIMEDOUT)';
  if (r.signal) return `vitest killed by ${r.signal}`;
  if (r.error) return `vitest could not run: ${r.error.message}`;
  return null;
}

const pick = (m) => ({ lines: m.lines.pct, branches: m.branches.pct, functions: m.functions.pct, statements: m.statements.pct });

export function summarizeCoverage(summary, root) {
  const files = {};
  for (const [k, v] of Object.entries(summary)) if (k !== 'total') files[rel(root, k)] = pick(v);
  return { total: pick(summary.total), files };
}

const SCRUB = new Set(['GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'GITHUB_STATE', 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']);
// Generated tests are arbitrary code: they must not see tokens or the runner's command files.
export const testEnv = (env = process.env) =>
  ({ ...Object.fromEntries(Object.entries(env).filter(([k]) => !SCRUB.has(k) && !k.startsWith('ACTIONS_'))), CI: 'true' });

export function runVitest({ root, pkg, files = [], coverage = false, spawn = spawnSync }) {
  const cwd = path.join(root, pkg);
  const runs = path.join(root, '.agentic-tests', 'runs');
  mkdirSync(runs, { recursive: true });
  const outputFile = path.join(runs, `${pkg}-${Date.now()}.json`);
  const summaryFile = path.join(cwd, 'coverage', 'coverage-summary.json');
  if (coverage) rmSync(summaryFile, { force: true });
  const args = ['vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`];
  if (coverage) args.push('--coverage');
  args.push(...files.map((f) => path.relative(cwd, path.join(root, f))));
  const r = spawn('npx', args, { cwd, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024, env: testEnv(process.env) });
  const abort = describeAbort(r);
  const exitCode = r.status ?? null;
  const empty = { passed: 0, failed: 0, total: 0, failedFiles: [], failures: [], ranFiles: [], thresholdsFailed: false, exitCode, exitError: abort };
  if (!existsSync(outputFile)) {
    return { ...empty, error: abort ?? `vitest produced no report (exit ${r.status}): ${String(r.stderr ?? '').slice(-800)}` };
  }
  let json;
  try {
    json = JSON.parse(readFileSync(outputFile, 'utf8'));
  } catch {
    return { ...empty, error: abort ?? 'vitest report is not valid JSON' };
  }
  const parsed = parseVitestJson(json, root);
  const result = { ...parsed, thresholdsFailed: false, exitCode, exitError: abort };
  if (abort) {
    result.error = abort;
  } else if (r.status !== 0 && parsed.failedFiles.length === 0) {
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (coverage && COVERAGE_THRESHOLD.test(output)) result.thresholdsFailed = true;
    else result.error = `vitest exited ${r.status} with no failed tests (unhandled error?): ${String(r.stderr ?? '').slice(-500)}`;
  }
  if (coverage && existsSync(summaryFile)) result.coverage = summarizeCoverage(JSON.parse(readFileSync(summaryFile, 'utf8')), root);
  return result;
}

export function formatFrontend(root, files) {
  const targets = files.filter((f) => f.startsWith('frontend/')).map((f) => path.relative(path.join(root, 'frontend'), path.join(root, f)));
  if (targets.length) spawnSync('npx', ['prettier', '--write', ...targets], { cwd: path.join(root, 'frontend'), encoding: 'utf8' });
}

export function verifyGenerated({ root, changes, packages, reject, coverage = true, run = runVitest }) {
  const generated = [...changes.created, ...changes.modified];
  const rejected = [];
  const isRejected = (f) => rejected.some((x) => x.file === f);
  const undo = (file, reason) => {
    if (isRejected(file)) return;
    reject(file, changes.created.includes(file) ? 'created' : 'modified');
    rejected.push({ file, reason });
  };
  const firstFailure = (r, file) => {
    const f = r.failures.find((x) => x.file === file);
    return f ? `${f.name}: ${f.message}` : 'failed';
  };

  for (const f of generated) if (isTestFile(f) && !packages.includes(packageOf(f))) undo(f, 'package not verified');

  for (const pkg of packages) {
    const files = generated.filter((f) => packageOf(f) === pkg && isTestFile(f));
    if (!files.length) continue;
    const r = run({ root, pkg, files });
    if (r.error) { files.forEach((f) => undo(f, `test run did not start: ${r.error}`)); continue; }
    for (const f of files) if (!r.ranFiles.includes(f)) undo(f, 'not executed by vitest');
    for (const f of r.failedFiles) if (generated.includes(f)) undo(f, firstFailure(r, f));
  }

  const verification = {};
  const coverageAfter = {};
  const coverageFiles = {};
  let existingFailing = false;
  for (const pkg of packages) {
    let r = run({ root, pkg, coverage });
    for (let attempt = 0; attempt < 3 && (r.failedFiles.length || r.error); attempt++) {
      const ours = generated.filter((f) => packageOf(f) === pkg && !isRejected(f));
      const blamed = r.failedFiles.filter((f) => ours.includes(f));
      const helpers = ours.filter((f) => !isTestFile(f));
      const toUndo = blamed.length ? blamed : helpers;
      if (!toUndo.length) break;
      toUndo.forEach((f) => undo(f, blamed.length ? `fails in the full suite: ${firstFailure(r, f)}` : 'shared test helper change broke the suite'));
      r = run({ root, pkg, coverage });
    }
    const stillFailing = r.failedFiles.filter((f) => generated.includes(f) && packageOf(f) === pkg && !isRejected(f));
    if (stillFailing.length) {
      stillFailing.forEach((f) => undo(f, 'still failing after retries'));
      r = run({ root, pkg, coverage });
    }
    verification[pkg] = { passed: r.passed, failed: Math.max(r.failed, r.failedFiles.length), total: r.total, failures: r.failures.slice(0, 10), thresholdsFailed: r.thresholdsFailed, error: r.error };
    if (r.error || r.failedFiles.length) existingFailing = true;
    if (r.coverage) { coverageAfter[pkg] = r.coverage.total; Object.assign(coverageFiles, r.coverage.files); }
  }
  return { verification, rejected, coverageAfter, coverageFiles, existingFailing };
}
