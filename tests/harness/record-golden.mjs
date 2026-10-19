#!/usr/bin/env node
// Record a golden from a real run you have looked at:
//   record-golden.mjs <Fxx> detect | scan-sweep | scan-standard
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './fixture.mjs';
import { normalize, stableDetect } from './stable.mjs';

const [id, what] = process.argv.slice(2);
if (!['detect', 'scan-sweep', 'scan-standard'].includes(what)) { console.error('usage: record-golden.mjs <Fxx> detect|scan-sweep|scan-standard'); process.exit(2); }
const dir = ensureFixture(id, { reset: true });
const env = { ...process.env, TS_OPT_HOME: what === 'detect' ? '/tmp/tsopt-golden-home' : join(DEV, 'home') };
const run = (args) => spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), ...args], { encoding: 'utf8', env });
const out = join(REPO, 'tests', 'golden', `${id}-${what}.json`);
if (what === 'detect') {
  const d = JSON.parse(run(['detect', '--json', '--refresh', '--cwd', dir]).stdout).result;
  writeFileSync(out, JSON.stringify(normalize(stableDetect(d), { root: d.root }), null, 2) + '\n');
} else {
  const r = run(['scan', '--cwd', dir, '--quiet', '--mode', what === 'scan-sweep' ? 'sweep' : 'standard']);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const runs = join(dir, '.ts-optimize', 'runs');
  const cands = readFileSync(join(runs, readdirSync(runs).sort().pop(), 'raw', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const project = (c) => ({ rule: c.rule, file: c.file, line: c.line, symbol: c.symbol, engine: c.engine.replace(/@[\d.]+/, '@V'), consumers: c.consumers ?? [] });
  writeFileSync(out, JSON.stringify(cands.map(project), null, 2) + '\n');
}
console.log('wrote', out);
