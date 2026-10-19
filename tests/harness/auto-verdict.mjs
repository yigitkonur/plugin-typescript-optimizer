#!/usr/bin/env node
// Test helper (NOT the product): judge a run's candidates from a fixture's SEEDS.json so ingest/plan/fix can be exercised without an LLM.
//   node tests/harness/auto-verdict.mjs <Fxx> [runId]   — confirmed unless a must_not_fire seed matches (then false-positive)
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, fixtureDir, workDir } from './fixture.mjs';

const id = process.argv[2];
const work = workDir(id);
const runs = join(work, '.ts-optimize', 'runs');
const run = process.argv[3] || readdirSync(runs).sort().pop();
const seeds = JSON.parse(readFileSync(join(fixtureDir(id), 'SEEDS.json'), 'utf8'));
const cands = readFileSync(join(runs, run, 'raw', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let n = 0;
for (const c of cands) {
  if (c.triage === 'deterministic') continue;
  const fp = (seeds.must_not_fire || []).some((s) => s.rule === c.rule && s.file === c.file && (s.line === undefined || s.line === c.line));
  const args = ['bin/ts-opt', 'verdict', 'add', '--cwd', work, '--run', run, '--candidate', c.id, '--verdict', fp ? 'false-positive' : 'confirmed', '--confidence', 'likely', '--q1', 'no', '--q2', 'no', '--q3', 'no',
    '--evidence', `rg -w ${c.symbol || c.rule} → test-harness verdict from SEEDS.json`, '--reason', fp ? 'seeded decoy (SEEDS.json must_not_fire)' : 'seeded defect (SEEDS.json)'];
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...process.env } });
  if (r.status !== 0) console.error(c.id, r.stderr.trim()); else n++;
}
console.log(`recorded ${n} verdicts for ${run}`);
