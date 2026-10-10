// scripts/agentic-tests/test/publish.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitViaApi, findOwnComment, upsertComment } from '../publish.js';
import { MARKER } from '../render-report.js';

test('findOwnComment only matches our marker from our author', () => {
  const comments = [
    { id: 1, body: `${MARKER} spoof`, user: { login: 'mallory' } },
    { id: 2, body: 'hello', user: { login: 'github-actions[bot]' } },
    { id: 3, body: `${MARKER}\nreal`, user: { login: 'github-actions[bot]' } },
  ];
  assert.equal(findOwnComment(comments, 'github-actions[bot]'), 3);
  assert.equal(findOwnComment(comments, 'someone'), null);
});

test('upsertComment patches an existing comment or creates one', () => {
  const calls = [];
  const api = (m, r, b) => { calls.push([m, r, b]); return {}; };
  assert.equal(upsertComment({ repo: 'o/r', pr: 5, body: 'B', author: 'bot', api, list: () => [{ id: 9, body: MARKER, user: { login: 'bot' } }] }), 'updated');
  assert.deepEqual(calls.at(-1), ['PATCH', 'repos/o/r/issues/comments/9', { body: 'B' }]);
  assert.equal(upsertComment({ repo: 'o/r', pr: 5, body: 'B', author: 'bot', api, list: () => [] }), 'created');
  assert.deepEqual(calls.at(-1), ['POST', 'repos/o/r/issues/5/comments', { body: 'B' }]);
});

function fakeApi(headSha) {
  const calls = [];
  const api = (method, route, body) => {
    calls.push({ method, route, body });
    if (route.includes('/git/ref/heads/')) return { object: { sha: headSha } };
    if (route.endsWith('/git/commits/base')) return { tree: { sha: 'tree0' } };
    if (route.endsWith('/git/blobs')) return { sha: `blob${calls.length}` };
    if (route.endsWith('/git/trees')) return { sha: 'tree1' };
    if (route.endsWith('/git/commits')) return { sha: 'commit1' };
    return {};
  };
  return { api, calls };
}

test('commitViaApi creates blobs, tree, commit and fast-forwards the branch', () => {
  const { api, calls } = fakeApi('base');
  const out = commitViaApi({ repo: 'o/r', branch: 'feature/x', expectedHead: 'base', files: ['backend/tests/a.test.ts'], message: 'm', read: () => Buffer.from('x'), api });
  assert.deepEqual(out, { status: 'committed', sha: 'commit1' });
  const last = calls.at(-1);
  assert.equal(last.method, 'PATCH');
  assert.equal(last.route, 'repos/o/r/git/refs/heads/feature/x');
  assert.deepEqual(last.body, { sha: 'commit1', force: false });
  assert.deepEqual(calls.find((c) => c.route.endsWith('/git/trees')).body.tree[0].path, 'backend/tests/a.test.ts');
});

test('commitViaApi refuses when the branch moved', () => {
  const { api, calls } = fakeApi('newer');
  const out = commitViaApi({ repo: 'o/r', branch: 'b', expectedHead: 'base', files: ['backend/tests/a.test.ts'], message: 'm', read: () => Buffer.from('x'), api });
  assert.equal(out.status, 'stale');
  assert.equal(calls.length, 1);
});

test('commitViaApi refuses non-test paths', () => {
  const { api } = fakeApi('base');
  assert.throws(() => commitViaApi({ repo: 'o/r', branch: 'b', expectedHead: 'base', files: ['backend/src/a.ts'], message: 'm', read: () => Buffer.from(''), api }), /non-test path/);
});
