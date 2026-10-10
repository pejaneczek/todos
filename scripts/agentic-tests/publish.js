// scripts/agentic-tests/publish.js
import { spawnSync } from 'node:child_process';
import { MARKER } from './render-report.js';
import { isTestPath } from './paths.js';

export function gh(args, { input } = {}) {
  const r = spawnSync(process.env.AGENTIC_TESTS_GH_BIN || 'gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr ?? '').trim().slice(0, 500)}`);
  return r.stdout;
}

export function ghApi(method, route, body) {
  const out = gh(['api', '-X', method, route, ...(body ? ['--input', '-'] : [])], { input: body ? JSON.stringify(body) : undefined });
  return out.trim() ? JSON.parse(out) : null;
}

const listComments = (repo, pr) => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`])).flat();

export const currentLogin = () => gh(['api', 'user', '--jq', '.login']).trim();

export function findOwnComment(comments, author) {
  return comments.find((c) => c.user?.login === author && typeof c.body === 'string' && c.body.startsWith(MARKER))?.id ?? null;
}

export function upsertComment({ repo, pr, body, author, api = ghApi, list = () => listComments(repo, pr) }) {
  const id = findOwnComment(list(), author);
  if (id) { api('PATCH', `repos/${repo}/issues/comments/${id}`, { body }); return 'updated'; }
  api('POST', `repos/${repo}/issues/${pr}/comments`, { body });
  return 'created';
}

const encodeBranch = (b) => b.split('/').map(encodeURIComponent).join('/');

export function commitViaApi({ repo, branch, expectedHead, files, message, read, api = ghApi }) {
  for (const f of files) if (!isTestPath(f)) throw new Error(`refusing to commit non-test path: ${f}`);
  const ref = api('GET', `repos/${repo}/git/ref/heads/${encodeBranch(branch)}`);
  if (ref.object.sha !== expectedHead) return { status: 'stale', error: `branch is at ${ref.object.sha.slice(0, 7)}, expected ${expectedHead.slice(0, 7)}` };
  const base = api('GET', `repos/${repo}/git/commits/${expectedHead}`);
  const tree = files.map((path) => ({
    path, mode: '100644', type: 'blob',
    sha: api('POST', `repos/${repo}/git/blobs`, { content: read(path).toString('base64'), encoding: 'base64' }).sha,
  }));
  const newTree = api('POST', `repos/${repo}/git/trees`, { base_tree: base.tree.sha, tree });
  const commit = api('POST', `repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: [expectedHead] });
  try {
    api('PATCH', `repos/${repo}/git/refs/heads/${encodeBranch(branch)}`, { sha: commit.sha, force: false });
  } catch (error) {
    return { status: 'stale', error: error.message };
  }
  return { status: 'committed', sha: commit.sha };
}
