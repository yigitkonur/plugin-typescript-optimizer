#!/usr/bin/env node
// Record a golden from a real run you have looked at: record-golden.mjs <Fxx> detect
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, ensureFixture } from './fixture.mjs';
import { normalize, stableDetect } from './stable.mjs';

const [id, what] = process.argv.slice(2);
if (what !== 'detect') { console.error('usage: record-golden.mjs <Fxx> detect'); process.exit(2); }
const dir = ensureFixture(id, { reset: true });
const r = spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), 'detect', '--json', '--refresh', '--cwd', dir], { encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: '/tmp/tsopt-golden-home' } });
const d = JSON.parse(r.stdout).result;
const out = join(REPO, 'tests', 'golden', `${id}-detect.json`);
writeFileSync(out, JSON.stringify(normalize(stableDetect(d), { root: d.root }), null, 2) + '\n');
console.log('wrote', out);
