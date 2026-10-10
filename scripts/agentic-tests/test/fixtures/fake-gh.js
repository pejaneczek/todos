#!/usr/bin/env node
// Fake gh: logs argv and stdin as JSON lines to $GH_LOG and answers canned JSON by route.
import { appendFileSync, readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
let stdin = '';
if (argv.includes('--input')) stdin = readFileSync(0, 'utf8');
appendFileSync(process.env.GH_LOG, `${JSON.stringify({ argv, stdin })}\n`);
const route = argv.find((a) => a.startsWith('repos/')) ?? '';
const method = argv.includes('-X') ? argv[argv.indexOf('-X') + 1] : undefined;
const out = (v) => process.stdout.write(JSON.stringify(v));
if (route.includes('/issues/') && route.endsWith('/comments') && method === undefined) out([[]]);
else if (route.includes('/git/ref/heads/')) out({ object: { sha: process.env.FAKE_REF_SHA } });
else if (route.includes('/git/commits/')) out({ tree: { sha: 'tree0' } });
else if (route.endsWith('/git/blobs')) out({ sha: 'blob1' });
else if (route.endsWith('/git/trees')) out({ sha: 'tree1' });
else if (route.endsWith('/git/commits')) out({ sha: 'commit1' });
else out({});
