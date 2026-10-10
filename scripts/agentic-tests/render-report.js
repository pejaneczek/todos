// scripts/agentic-tests/render-report.js
export const MARKER = '<!-- agentic-tests -->';

const STATUS = {
  committed: '✅ Tests added and committed',
  'tests-ready': '✅ Tests written and verified (uncommitted)',
  'nothing-to-test': 'ℹ️ No testable source changes',
  'no-changes': 'ℹ️ No test changes needed',
  'agent-failed': '⚠️ Agent failed: no tests were added',
  'guard-violation': '⛔ Rejected: the agent touched non-test files',
  'existing-tests-failing': '❌ Existing tests are failing',
  'publish-failed': '❌ Publishing failed',
  stale: '⚠️ The branch moved during the run: re-run the workflow',
};

const MAX_FILES = 200;
const MAX_FINDINGS = 50;
const MAX_DECISION_ROWS = 100;
const MAX_FINDING_ROWS = 30;
const MAX_REJECTED_ROWS = 50;
const MAX_BODY = 60000;
const TRUNCATE_AT = 59000;

// Every agent-provided string goes through here before reaching the PR comment.
// Order matters: backslashes first so escapes are not doubled, then "&" before "<"/">"
// so entity-encoded text cannot slip through, then zero-width spaces to break mentions,
// autolinks and issue references.
export function sanitize(value, max = 300) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/:(?=\/\/)/g, ':​')
    .replace(/www(?=\.)/gi, (m) => m + '​')
    .replace(/#(?=\d)/g, '​#')
    .replace(/@/g, '@​')
    .slice(0, max);
}

const code = (p) => `\`${sanitize(p, 200)}\``;
const pct = (n) => (typeof n === 'number' ? `${n.toFixed(1)}%` : 'n/a');
const change = (before, after) => (before == null ? pct(after) : `${pct(before)} → ${pct(after)}`);
const isCount = (x) => Number.isInteger(x) && x >= 0;
const arr = (x) => (Array.isArray(x) ? x : []);

export function validateAgentReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['report is not an object'];
  const e = [];
  if (!Array.isArray(r.files)) e.push('files must be an array');
  else {
    if (r.files.length > MAX_FILES) e.push(`files has too many entries (max ${MAX_FILES})`);
    r.files.forEach((f, i) => {
      if (typeof f?.source !== 'string') e.push(`files[${i}].source must be a string`);
      if (!['create', 'update', 'skip'].includes(f?.decision)) e.push(`files[${i}].decision must be create|update|skip`);
      if (typeof f?.reason !== 'string' || !f.reason.trim()) e.push(`files[${i}].reason is required`);
      if (f?.decision && f.decision !== 'skip' && typeof f?.test_file !== 'string') e.push(`files[${i}].test_file is required unless skipped`);
      if (f?.cases_added !== undefined && !isCount(f.cases_added)) e.push(`files[${i}].cases_added must be a non-negative integer`);
      if (f?.cases_modified !== undefined && !isCount(f.cases_modified)) e.push(`files[${i}].cases_modified must be a non-negative integer`);
    });
  }
  if (!Array.isArray(r.skills_used) || r.skills_used.some((s) => typeof s !== 'string')) e.push('skills_used must be an array of strings');
  if (!Array.isArray(r.findings)) e.push('findings must be an array');
  else {
    if (r.findings.length > MAX_FINDINGS) e.push(`findings has too many entries (max ${MAX_FINDINGS})`);
    r.findings.forEach((f, i) => {
      if (!['suspected_bug', 'untestable', 'note'].includes(f?.type)) e.push(`findings[${i}].type is invalid`);
      if (typeof f?.file !== 'string') e.push(`findings[${i}].file must be a string`);
      if (typeof f?.detail !== 'string') e.push(`findings[${i}].detail must be a string`);
    });
  }
  if (!r.agent_test_run || typeof r.agent_test_run !== 'object') e.push('agent_test_run must be an object');
  else {
    if (!isCount(r.agent_test_run.passed)) e.push('agent_test_run.passed must be a non-negative integer');
    if (!isCount(r.agent_test_run.failed)) e.push('agent_test_run.failed must be a non-negative integer');
  }
  return e;
}

// Verification, coverage, guard kinds and package keys must come from the pipeline only.
// Agent text always goes through sanitize or code.
export function renderMarkdown(report) {
  const L = [MARKER, `## 🧪 Agentic unit tests: ${STATUS[report.status] ?? sanitize(report.status)}`, ''];
  const agentReport = report.agent?.report;
  const files = arr(agentReport?.files);
  const findings = arr(agentReport?.findings);
  const skills = arr(agentReport?.skills_used);
  const rejected = arr(report.rejected);

  if (arr(report.guard?.violations).length) {
    L.push('**Guard violations** (all agent output was discarded):', '');
    for (const v of arr(report.guard.violations).slice(0, 20)) L.push(`- ${sanitize(v.kind, 40)}: ${code(v.file)}`);
    L.push('');
  }
  if (report.agent && !report.agent.ok) {
    L.push('**Agent errors:**', '');
    for (const e of arr(report.agent.errors).slice(0, 10)) L.push(`- ${sanitize(e, 500)}`);
    L.push('');
  }

  const verification = Object.entries(report.verification ?? {});
  if (verification.length) {
    L.push('### Verification (pipeline)', '', '| Package | Passed | Failed | Lines | Branches |', '|---|---|---|---|---|');
    for (const [pkg, v] of verification) {
      const b = report.coverage?.before?.[pkg];
      const a = report.coverage?.after?.[pkg];
      L.push(`| ${sanitize(pkg, 40)} | ${Number(v.passed)} | ${Number(v.failed)} | ${change(b?.lines, a?.lines)} | ${change(b?.branches, a?.branches)} |`);
    }
    L.push('');
    for (const [pkg, v] of verification) {
      if (v.error) L.push(`- ${pkg}: ${sanitize(v.error, 500)}`);
      if (v.thresholdsFailed) L.push(`- ${pkg}: coverage thresholds not met`);
      for (const f of arr(v.failures)) L.push(`- ❌ ${code(f.file)}: ${sanitize(f.name)}: ${sanitize(f.message)}`);
    }
    L.push('');
  }

  const unpublished = arr(report.verifiedButNotPublished).filter((f) => typeof f === 'string');
  if (unpublished.length) L.push(`Passing generated tests not committed: ${unpublished.slice(0, 20).map(code).join(', ')}`, '');
  if (rejected.length) {
    L.push('### Rejected tests', '');
    for (const r of rejected.slice(0, MAX_REJECTED_ROWS)) L.push(`- ${code(r.file)}: ${sanitize(r.reason)}`);
    L.push('');
  }

  if (files.length) {
    L.push('### Decisions', '', '| Source | Decision | Test file | Cases (+/~, agent-reported) | Reason |', '|---|---|---|---|---|');
    for (const f of files.slice(0, MAX_DECISION_ROWS)) {
      const wasRejected = rejected.some((r) => r.file === f.test_file);
      L.push(`| ${code(f.source)} | ${sanitize(f.decision, 10)}${wasRejected ? ' (rejected)' : ''} | ${f.test_file ? code(f.test_file) : '—'} | ${Number(f.cases_added ?? 0)}/${Number(f.cases_modified ?? 0)} | ${sanitize(f.reason)} |`);
    }
    if (files.length > MAX_DECISION_ROWS) L.push(`…and ${files.length - MAX_DECISION_ROWS} more files (see report.json artifact)`);
    L.push('');
  }

  if (findings.length) {
    L.push('### Findings', '');
    for (const f of findings.slice(0, MAX_FINDING_ROWS)) L.push(`- **${sanitize(f.type, 20)}** ${code(f.file)}: ${sanitize(f.detail, 500)}`);
    L.push('');
  }

  if (typeof report.commit?.sha === 'string' && /^[0-9a-f]{7,40}$/.test(report.commit.sha)) L.push(`Committed \`${report.commit.sha.slice(0, 7)}\` to the PR branch.`, '');
  if (report.commit?.error) L.push(`Commit not created: ${sanitize(report.commit.error)}`, '');

  const skipped = arr(report.classification?.skipped);
  L.push('<details><summary>Run details</summary>', '');
  L.push(`- Mode: ${sanitize(report.context?.mode)}${report.context?.base ? `, base ${code(report.context.base)}` : ''}`);
  if (skills.length) L.push(`- Skills used: ${skills.map((s) => code(s)).join(', ')}`);
  if (report.agent) L.push(`- Agent turns: ${Number(report.agent.turns ?? 0)}, cost: $${Number(report.agent.costUsd ?? 0).toFixed(2)}`);
  if (skipped.length) {
    L.push('- Skipped before the agent ran:');
    for (const s of skipped.slice(0, 50)) L.push(`  - ${code(s.file)}: ${sanitize(s.reason)}`);
  }
  L.push('', '</details>');

  let out = L.join('\n');
  if (out.length > MAX_BODY) {
    const cut = out.lastIndexOf('\n', TRUNCATE_AT);
    out = out.slice(0, cut > 0 ? cut : TRUNCATE_AT) + '\n\n_(truncated)_';
    const opened = (out.match(/<details>/g) ?? []).length;
    const closed = (out.match(/<\/details>/g) ?? []).length;
    if (opened > closed) out += '\n</details>';
  }
  return out;
}
