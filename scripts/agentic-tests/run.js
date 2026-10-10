#!/usr/bin/env node
// scripts/agentic-tests/run.js: one pipeline for local runs and CI stages.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAgentBatches } from './agent.js';
import { classify, filterByCoverage, targetCount } from './classify-changes.js';
import { allSourceFiles, changedFiles, diffFor, git, mergeBase, repoRoot, untrackedFiles } from './git.js';
import { changedTestFiles, enforce, patchFileViolations, rejectFile, snapshot } from './guard.js';
import { commitViaApi, currentLogin, gh, upsertComment } from './publish.js';
import { isTestPath, packageOf } from './paths.js';
import { renderMarkdown } from './render-report.js';
import { formatFrontend, runVitest, verifyGenerated } from './verify.js';

const ROOT = repoRoot();
const OUT = path.join(ROOT, '.agentic-tests');
const FAILING = new Set(['guard-violation', 'existing-tests-failing', 'publish-failed']);
const STATE_STATUSES = new Set(['agent-done', 'nothing-to-test', 'agent-failed', 'guard-violation']);
const BUNDLE_STATUSES = new Set(['tests-ready', 'nothing-to-test', 'no-changes', 'agent-failed', 'guard-violation', 'existing-tests-failing', 'stale']);

const { values: opts } = parseArgs({
  options: {
    base: { type: 'string', default: 'origin/main' },
    pr: { type: 'string' },
    all: { type: 'boolean', default: false },
    post: { type: 'boolean', default: false },
    'skip-coverage': { type: 'boolean', default: false },
    ci: { type: 'boolean', default: false },
    stage: { type: 'string' },
    artifacts: { type: 'string' },
  },
});

function validateArgs() {
  if (opts.post && !opts.pr) throw new Error('--post requires --pr');
  if (opts.post && opts.ci) throw new Error('--post is not allowed with --ci');
  if (opts.stage && !opts.ci) throw new Error('--stage requires --ci');
  if (opts.ci && !opts.stage) throw new Error('--ci requires --stage');
  if (opts.ci && !['agent', 'verify', 'publish'].includes(opts.stage)) throw new Error(`unknown stage ${opts.stage}`);
  if (['verify', 'publish'].includes(opts.stage) && !opts.artifacts) throw new Error(`--stage ${opts.stage} requires --artifacts`);
}

const packagesOf = (c) => ['backend', 'frontend'].filter((p) => c[p].length);
const writeJson = (name, data) => writeFileSync(path.join(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function newReport(context, classification) {
  return {
    status: 'running', context, classification, agent: null, guard: { violations: [] },
    changes: { created: [], modified: [], deleted: [] }, accepted: [], rejected: [],
    verification: {}, coverage: { before: {}, after: {} },
  };
}

function collect() {
  if (opts.all) return { files: allSourceFiles(ROOT), base: null, context: { mode: 'all' } };
  let base = opts.base;
  if (opts.pr && !opts.ci) {
    const pr = JSON.parse(gh(['pr', 'view', opts.pr, '--json', 'headRefName,baseRefName']));
    const branch = git(['branch', '--show-current'], { cwd: ROOT });
    if (branch !== pr.headRefName) throw new Error(`Check out the PR branch first: gh pr checkout ${opts.pr}`);
    git(['fetch', '--quiet', 'origin', pr.baseRefName], { cwd: ROOT });
    base = `origin/${pr.baseRefName}`;
  }
  const mb = mergeBase(ROOT, base);
  return { files: changedFiles(ROOT, mb), base: mb, context: { mode: opts.ci ? 'ci' : 'local', base, pr: opts.pr ?? process.env.PR_NUMBER } };
}

function measureCoverage(report, packages) {
  const files = {};
  for (const pkg of packages) {
    const r = runVitest({ root: ROOT, pkg, coverage: true });
    if (r.coverage) { report.coverage.before[pkg] = r.coverage.total; Object.assign(files, r.coverage.files); }
  }
  return files;
}

// Analyze, (coverage before), snapshot, agent, guard. Returns { report, snap } or a finished report.
function agentPhase({ keepRejected }) {
  mkdirSync(OUT, { recursive: true });
  for (const f of ['report.json', 'report.md', 'agent-report.json', 'state.json', 'tests.patch']) rmSync(path.join(OUT, f), { force: true });
  const { files, base, context } = collect();
  let classification = classify(files, { root: ROOT });
  const report = newReport(context, classification);
  if (!targetCount(classification)) return { report: { ...report, status: 'nothing-to-test' } };

  if (!opts['skip-coverage']) {
    const perFile = measureCoverage(report, packagesOf(classification));
    if (opts.all) {
      classification = filterByCoverage(classification, perFile);
      report.classification = classification;
      if (!targetCount(classification)) return { report: { ...report, status: 'nothing-to-test' } };
    }
  }

  const untracked = untrackedFiles(ROOT);
  const snap = snapshot(ROOT);
  let thrown = null;
  try {
    report.agent = runAgentBatches({
      root: ROOT, classification, untracked,
      diffFor: (batch) => (base ? diffFor(ROOT, base, batch.filter((f) => !untracked.includes(f))) : ''),
    });
  } catch (error) {
    thrown = error;
  }

  // The guard runs even when the agent phase crashed.
  const violations = enforce(ROOT, snap);
  report.changes = changedTestFiles(ROOT, snap);
  if (violations.length) {
    report.guard.violations = violations;
    discardAll(report, snap, keepRejected, 'agent modified non-test files; all output discarded');
    return { report: { ...report, status: 'guard-violation' } };
  }
  if (thrown) {
    discardAll(report, snap, keepRejected, 'agent phase crashed; all output discarded');
    throw thrown;
  }
  if (!report.agent.ok) {
    discardAll(report, snap, keepRejected, 'agent run failed; all output discarded');
    return { report: { ...report, status: 'agent-failed' } };
  }
  if (report.changes.deleted.length) {
    for (const f of report.changes.deleted) rejectFile(ROOT, snap, f, 'deleted');
    report.rejected.push(...report.changes.deleted.map((file) => ({ file, reason: 'deleting test files is not allowed; restored' })));
  }
  return { report, snap };
}

function discardAll(report, snap, keepDir, reason) {
  for (const f of report.changes.created) rejectFile(ROOT, snap, f, 'created', keepDir);
  for (const f of report.changes.modified) rejectFile(ROOT, snap, f, 'modified');
  for (const f of report.changes.deleted) rejectFile(ROOT, snap, f, 'deleted');
  report.rejected.push(...[...report.changes.created, ...report.changes.modified, ...report.changes.deleted].map((file) => ({ file, reason })));
}

function verifyPhase(report, snap, keepRejected) {
  const { created, modified } = report.changes;
  const generated = [...created, ...modified];
  formatFrontend(ROOT, generated);
  // Hash everything before any test code runs; publishing must match what was verified.
  const fileHash = (f) => { try { return sha256(readFileSync(path.join(ROOT, f))); } catch { return null; } };
  const preHashes = new Map(generated.map((f) => [f, fileHash(f)]));
  // Helpers outside the classified packages must be verified too.
  const packages = [...new Set([...packagesOf(report.classification), ...generated.map(packageOf).filter(Boolean)])];
  let result = null;
  let thrown = null;
  try {
    result = verifyGenerated({
      root: ROOT, changes: report.changes, packages,
      coverage: !opts['skip-coverage'],
      reject: (file, kind) => rejectFile(ROOT, snap, file, kind, keepRejected),
    });
  } catch (error) {
    thrown = error;
  }

  // Tests are arbitrary code: re-check that running them did not alter non-test files.
  const violations = enforce(ROOT, snap);
  if (violations.length) {
    report.guard.violations = [...report.guard.violations, ...violations];
    const already = new Set([...report.rejected, ...(result?.rejected ?? [])].map((r) => r.file));
    for (const f of generated.filter((g) => !already.has(g))) {
      rejectFile(ROOT, snap, f, created.includes(f) ? 'created' : 'modified', keepRejected);
      report.rejected.push({ file: f, reason: 'tests altered non-test files; all output discarded' });
    }
    if (result) report.rejected.push(...result.rejected);
    report.accepted = [];
    return 'guard-violation';
  }
  if (thrown) throw thrown;
  report.verification = result.verification;
  report.rejected.push(...result.rejected);
  report.coverage.after = result.coverageAfter;
  report.accepted = [];
  for (const f of generated) {
    if (report.rejected.some((r) => r.file === f)) continue;
    if (fileHash(f) === preHashes.get(f)) { report.accepted.push(f); continue; }
    rejectFile(ROOT, snap, f, created.includes(f) ? 'created' : 'modified', keepRejected);
    report.rejected.push({ file: f, reason: 'modified during test execution' });
  }
  if (result.existingFailing) return 'existing-tests-failing';
  if (report.accepted.length) return 'tests-ready';
  return 'no-changes';
}

function finish(report) {
  mkdirSync(OUT, { recursive: true });
  writeJson('report.json', report);
  const md = renderMarkdown(report);
  writeFileSync(path.join(OUT, 'report.md'), md);
  return md;
}

function local() {
  const keep = path.join(OUT, 'rejected');
  rmSync(keep, { recursive: true, force: true });
  const { report, snap } = agentPhase({ keepRejected: keep });
  if (snap) report.status = verifyPhase(report, snap, keep);
  const md = finish(report);
  process.stdout.write(`${md}\n`);
  if (opts.post) {
    if (!opts.pr) throw new Error('--post requires --pr');
    const repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    upsertComment({ repo, pr: opts.pr, body: md, author: currentLogin() });
  }
  return FAILING.has(report.status) ? 1 : 0;
}

function ciAgent() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('::error::ANTHROPIC_API_KEY secret is not configured'); return 1; }
  const { report, snap } = agentPhase({ keepRejected: null });
  if (snap) {
    const files = [...report.changes.created, ...report.changes.modified];
    rmSync(path.join(OUT, 'tests.patch'), { force: true });
    if (files.length) {
      git(['add', '--', ...files], { cwd: ROOT });
      writeFileSync(path.join(OUT, 'tests.patch'), `${git(['diff', '--cached', '--binary', '--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--', ...files], { cwd: ROOT })}\n`);
    }
    report.status = 'agent-done';
  }
  if (report.status !== 'agent-done') rmSync(path.join(OUT, 'tests.patch'), { force: true });
  writeJson('state.json', report);
  return 0;
}

const isStrings = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');
const isNumTree = (v, depth = 0) => (typeof v === 'number' && Number.isFinite(v))
  || (depth < 3 && v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => isNumTree(x, depth + 1)));

const classificationValid = (c) => !!c && isStrings(c.backend) && isStrings(c.frontend) && Array.isArray(c.skipped);
const agentValid = (a) => a === null || (typeof a === 'object' && typeof a.ok === 'boolean');

function stateValid(s) {
  if (!s || typeof s !== 'object' || !STATE_STATUSES.has(s.status)) return false;
  return classificationValid(s.classification) && agentValid(s.agent);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCnt = (n) => Number.isInteger(n) && n >= 0;

// Rebuild the verification block from scratch: only known packages, only typed fields.
function sanitizeVerification(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const pkg of ['backend', 'frontend']) {
    const e = v[pkg];
    if (!isObj(e) || !isCnt(e.passed) || !isCnt(e.failed) || !isCnt(e.total)) continue;
    const item = { passed: e.passed, failed: e.failed, total: e.total, thresholdsFailed: e.thresholdsFailed === true };
    if (typeof e.error === 'string') item.error = e.error;
    item.failures = (Array.isArray(e.failures) ? e.failures : [])
      .filter((f) => isObj(f) && typeof f.file === 'string' && typeof f.name === 'string' && typeof f.message === 'string')
      .map((f) => ({ file: f.file, name: f.name, message: f.message }));
    out[pkg] = item;
  }
  return out;
}

// Never trust state.json: keep only validated fields and rebuild everything the verify stage computes.
function rebuildReport(state, headSha) {
  const valid = stateValid(state);
  const context = { ...Object.fromEntries(Object.entries(state?.context ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))), headSha };
  const c = valid ? state.classification : { backend: [], frontend: [], skipped: [] };
  const classification = {
    ...c,
    existingTests: c.existingTests && typeof c.existingTests === 'object' && !Array.isArray(c.existingTests) ? c.existingTests : {},
  };
  const report = newReport(context, classification);
  if (!valid) {
    report.status = 'guard-violation';
    report.guard.violations = [{ file: 'state.json', kind: 'invalid-artifact' }];
    return report;
  }
  report.status = state.status;
  report.agent = state.agent;
  if (Array.isArray(state.guard?.violations)) report.guard.violations = state.guard.violations;
  if (state.coverage?.before && isNumTree(state.coverage.before)) report.coverage.before = state.coverage.before;
  return report;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function writeBundle(report) {
  const dir = path.join(OUT, 'publish');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'files'), { recursive: true });
  report.acceptedHashes = {};
  if (report.status !== 'tests-ready') {
    report.verifiedButNotPublished = report.accepted;
    report.accepted = [];
  }
  for (const f of report.accepted) {
    const bytes = readFileSync(path.join(ROOT, f));
    report.acceptedHashes[f] = sha256(bytes);
    const dest = path.join(dir, 'files', f);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function ciVerify() {
  const dir = opts.artifacts;
  let state = null;
  try { state = readJson(path.join(dir, 'state.json')); } catch { /* invalid below */ }
  const report = rebuildReport(state, process.env.EXPECTED_HEAD);
  const expected = process.env.EXPECTED_HEAD;
  if (report.status === 'agent-done' && expected && git(['rev-parse', 'HEAD'], { cwd: ROOT }) !== expected) {
    report.status = 'stale';
  }
  if (report.status === 'agent-done') {
    const patchFile = path.join(dir, 'tests.patch');
    const hasPatch = existsSync(patchFile) && readFileSync(patchFile, 'utf8').trim();
    const violations = hasPatch ? patchFileViolations(ROOT, patchFile) : [];
    if (violations.length) {
      report.guard.violations = violations;
      report.status = 'guard-violation';
    } else {
      const snap = snapshot(ROOT);
      if (hasPatch) git(['apply', '--whitespace=nowarn', patchFile], { cwd: ROOT });
      report.changes = changedTestFiles(ROOT, snap);
      report.status = verifyPhase(report, snap, null);
    }
  }
  writeBundle(report);
  finish(report);
  return 0;
}

// Reads only from the bundle directory; the repository working tree is never consulted.
function validateBundle(dir) {
  const report = readJson(path.join(dir, 'report.json'));
  if (!report || typeof report !== 'object' || !BUNDLE_STATUSES.has(report.status)) throw new Error('unknown status in bundle');
  if (!isStrings(report.accepted) || !report.accepted.every(isTestPath)) throw new Error('accepted contains a non-test path');
  const hashes = report.acceptedHashes;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) throw new Error('acceptedHashes missing');
  const keys = Object.keys(hashes).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...report.accepted].sort()) || new Set(report.accepted).size !== report.accepted.length) {
    throw new Error('acceptedHashes does not match accepted');
  }
  for (const f of report.accepted) {
    const file = path.join(dir, 'files', f);
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw new Error(`bundle file is not a regular file: ${f}`);
    if (sha256(readFileSync(file)) !== hashes[f]) throw new Error(`hash mismatch: ${f}`);
  }
  // The hash only protects the bundle in transit. The verify job ran untrusted code, so every
  // other field is rebuilt from scratch with strict shape checks.
  const clean = newReport(
    Object.fromEntries(Object.entries(isObj(report.context) ? report.context : {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))),
    { backend: [], frontend: [], skipped: [], existingTests: {} },
  );
  clean.status = report.status;
  clean.accepted = report.accepted;
  clean.acceptedHashes = hashes;
  if (classificationValid(report.classification)) {
    const c = report.classification;
    clean.classification = { ...c, existingTests: isObj(c.existingTests) ? c.existingTests : {} };
  }
  if (agentValid(report.agent)) clean.agent = report.agent;
  if (isObj(report.guard) && Array.isArray(report.guard.violations)) {
    clean.guard.violations = report.guard.violations.filter((v) => isObj(v) && typeof v.file === 'string' && typeof v.kind === 'string');
  }
  if (Array.isArray(report.rejected)) {
    clean.rejected = report.rejected.filter((r) => isObj(r) && typeof r.file === 'string' && typeof r.reason === 'string');
  }
  clean.verification = sanitizeVerification(report.verification);
  if (isObj(report.coverage) && isNumTree(report.coverage.before) && isNumTree(report.coverage.after)) {
    clean.coverage = { before: report.coverage.before, after: report.coverage.after };
  }
  if (isStrings(report.verifiedButNotPublished) && report.verifiedButNotPublished.every(isTestPath)) {
    clean.verifiedButNotPublished = report.verifiedButNotPublished;
  }
  return clean;
}

function ciPublish() {
  const env = process.env;
  for (const k of ['EXPECTED_HEAD', 'HEAD_REF', 'PR_NUMBER', 'GITHUB_REPOSITORY']) {
    if (!env[k]) throw new Error(`publish stage requires ${k}`);
  }
  const dir = opts.artifacts;
  const repo = env.GITHUB_REPOSITORY;
  let report;
  try {
    report = validateBundle(dir);
  } catch (error) {
    report = newReport({}, { backend: [], frontend: [], skipped: [], existingTests: {} });
    report.status = 'publish-failed';
    report.commit = { status: 'error', error: error.message };
  }
  if (report.status === 'tests-ready' && report.accepted.length) {
    try {
      report.commit = commitViaApi({
        repo, branch: env.HEAD_REF, expectedHead: env.EXPECTED_HEAD, files: report.accepted,
        message: `test: add/update unit tests for #${env.PR_NUMBER} [agentic-tests]`,
        read: (f) => readFileSync(path.join(dir, 'files', f)),
      });
      report.status = report.commit.status === 'committed' ? 'committed' : 'stale';
    } catch (error) {
      report.status = 'publish-failed';
      report.commit = { status: 'error', error: error.message };
    }
  }
  let md;
  try {
    md = finish(report);
  } catch {
    const safe = newReport({}, { backend: [], frontend: [], skipped: [], existingTests: {} });
    safe.status = 'publish-failed';
    safe.commit = { status: 'error', error: 'bundle report could not be rendered' };
    report = safe;
    md = finish(report);
  }
  upsertComment({ repo, pr: env.PR_NUMBER, body: md, author: 'github-actions[bot]' });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
  return FAILING.has(report.status) ? 1 : 0;
}

try {
  validateArgs();
  const stages = { agent: ciAgent, verify: ciVerify, publish: ciPublish };
  process.exitCode = opts.ci ? (stages[opts.stage] ?? (() => { throw new Error(`unknown stage ${opts.stage}`); }))() : local();
} catch (error) {
  console.error(`agentic-tests: ${error.message}`);
  process.exitCode = 1;
}
