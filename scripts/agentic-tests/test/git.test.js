import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listRepoFiles } from '../git.js';

test('git calls do not run a poisoned core.fsmonitor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentic-git-'));
  const marker = path.join(dir, 'marker');
  const hook = path.join(dir, 'fsmonitor.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`);
  chmodSync(hook, 0o755);
  const sh = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  sh('init', '-q');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  sh('config', 'core.fsmonitor', hook);
  assert.deepEqual(listRepoFiles(dir).filter((f) => f === 'a.txt'), ['a.txt']);
  assert.equal(existsSync(marker), false);
});
