// Copies the repository into a temp dir and pins it to a deterministic state, so the pipeline tests
// do not depend on whatever is in the real working tree (uncommitted tests, local edits).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every file a fake agent or a test patch writes. They must not pre-exist in the copy.
export const FAKE_AGENT_OUTPUTS = ['backend/tests/health.test.ts', 'backend/tests/a.test.ts', 'backend/tests/b.test.ts'];

const git = (dir, args) => {
  const r = spawnSync('git', [
    '-c', 'user.name=agentic-tests', '-c', 'user.email=agentic-tests@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed in temp copy: ${r.stderr}`);
};

// Only ever commits inside the temp copy (its own copied .git), never in the real repository.
export function hermeticCopy(root, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cpSync(root, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|coverage|\.agentic-tests)$/.test(src) });
  for (const f of FAKE_AGENT_OUTPUTS) rmSync(path.join(dir, f), { force: true });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'test fixture snapshot']);
  return dir;
}
