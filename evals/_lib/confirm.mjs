#!/usr/bin/env node
// Eval scaffold helper: record `confirmed` verdicts through the real CLI for every candidate of the given rules, defer the rest, then ingest.
//   node confirm.mjs <plugin-root> <rule> [<rule> ...]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [plugin, ...rules] = process.argv.slice(2);
const ts = join(plugin, 'bin', 'ts-opt');
const run = (...a) => { const r = spawnSync(process.execPath, [ts, ...a], { encoding: 'utf8' }); if (r.status !== 0) { process.stderr.write(`ts-opt ${a.join(' ')}: ${r.stdout}${r.stderr}`); process.exit(1); } return r; };
const runDir = join('.ts-optimize', 'runs', readdirSync(join('.ts-optimize', 'runs')).sort().pop());
const cands = readFileSync(join(runDir, 'raw', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const c of cands.filter((x) => rules.includes(x.rule))) {
  run('verdict', 'add', '--candidate', c.id, '--verdict', 'confirmed', '--confidence', 'likely', '--q1', 'no', '--q2', 'no', '--q3', 'no', '--evidence', 'eval scaffold: engine output reviewed', '--reason', 'eval scaffold');
}
run('verdict', 'status', '--defer-missing', '--reason', 'eval scaffold');
run('findings', 'ingest');
