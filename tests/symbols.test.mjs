// Symbols engine (struct-06, struct-07, type-03): precision fixtures under tests/fixtures/rules/<id>/ (expect.json keys symbols_fire / symbols_silent)
// plus F01 deep-mode seeds. Run: node --test tests/symbols.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { loadRules } from '../lib/catalog/index.mjs';
import { ENGINES } from '../lib/engines/index.mjs';
import * as symbols from '../lib/engines/symbols.mjs';

process.env.TSOPT_NS = 'symbols'; // own fixture copies: test files run in parallel
const RULES = loadRules();
const DIR = join(REPO, 'tests', 'fixtures', 'rules');
const BIN = join(REPO, 'bin', 'ts-opt');
const walk = (dir, rel = '') => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? walk(dir, rel ? `${rel}/${n}` : n) : [rel ? `${rel}/${n}` : n]));
const SRC = /\.[cm]?tsx?$/;

async function runEngine(root, ruleIds, packages = []) {
  const files = walk(root).filter((f) => SRC.test(f)).sort();
  const rules = ruleIds.map((id) => RULES.get(id));
  return (await symbols.run({ root, detect: { packages }, rules, files, scope: { files, all_files: files }, config: {}, mode: 'deep' })).candidates;
}

test('engine is registered and claims exactly the three symbols adapters', () => {
  assert.ok(ENGINES.includes(symbols));
  for (const id of ['struct-06', 'struct-07', 'type-03']) assert.ok(symbols.handles(RULES.get(id)), id);
  assert.ok(!symbols.handles(RULES.get('struct-04')), 'symbols:implementers is not implemented here');
  for (const id of ['struct-06', 'struct-07', 'type-03']) assert.deepEqual(RULES.get(id).modes, ['deep']);
});

for (const id of ['struct-07', 'struct-06', 'type-03']) {
  test(`${id}: must-fire fires on the listed definitions, must-not-fire stays silent`, async () => {
    const root = join(DIR, id);
    const exp = JSON.parse(readFileSync(join(root, 'expect.json'), 'utf8'));
    const cands = await runEngine(root, [id]);
    assert.ok(cands.every((c) => c.rule === id && c.engine.startsWith('symbols:') && c.consumers && c.grain === 'symbol' && c.triage === 'agent'));
    assert.deepEqual(cands.map((c) => `${c.file}:${c.line}:${c.symbol}`).sort(), exp.symbols_fire.map((x) => `${x.file}:${x.line}:${x.symbol}`).sort());
    for (const x of exp.symbols_fire) {
      const c = cands.find((k) => k.file === x.file && k.line === x.line);
      if ('identical' in x) { assert.equal(c.identical_bodies, x.identical, x.file); assert.equal(c.confidence_hint, x.identical ? 'certain' : 'likely'); }
      if (x.consumers) assert.deepEqual(c.consumers, x.consumers, x.file);
    }
    for (const s of exp.symbols_silent) assert.equal(cands.filter((c) => c.file === s).length, 0, `${s} must be silent`);
    for (const s of exp.symbols_silent_symbols || []) assert.equal(cands.filter((c) => `${c.file}:${c.symbol}` === s).length, 0, `${s} must be silent`);
  });
}

test('struct-07: identical copies share one body hash, diverging ones do not; every member lists all sites', async () => {
  const cands = await runEngine(join(DIR, 'struct-07'), ['struct-07']);
  const slug = cands.filter((c) => c.symbol === 'slugify');
  assert.equal(new Set(slug.map((c) => c.body_hash)).size, 1);
  assert.deepEqual(slug[0].copies, ['a/slugify.ts:1', 'b/slugify.ts:2']);
  const clamp = cands.filter((c) => c.symbol === 'clamp');
  assert.equal(new Set(clamp.map((c) => c.body_hash)).size, 2);
  assert.ok(clamp.every((c) => c.confidence_hint === 'likely'));
});

test('struct-07: the same name in two packages does not fire; in one package it does', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tsopt-sym-'));
  try {
    const put = (f, t) => { mkdirSync(dirname(join(tmp, f)), { recursive: true }); writeFileSync(join(tmp, f), t); };
    const body = 'export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n';
    put('packages/a/src/sleep.ts', body); put('packages/b/src/sleep.ts', body); put('packages/b/src/other.ts', body.replace('(r)', '(done)').replace('r,', 'done,'));
    const pk = (p) => ({ path: p, name: p, tsconfigs: [] });
    const cands = await runEngine(tmp, ['struct-07'], [pk('packages/a'), pk('packages/b')]);
    assert.deepEqual(cands.map((c) => c.file), ['packages/b/src/other.ts', 'packages/b/src/sleep.ts']);
    assert.ok(cands.every((c) => c.package === 'packages/b' && c.identical_bodies));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('F01 deep: struct-07 reports the three cn copies at the seeded lines; no struct-06/struct-07/type-03 decoy fires', () => {
  const work = ensureFixture('F01', { reset: true });
  const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home'), TS_OPT_NOW: '2026-10-19T14:32:00Z', TS_OPT_RUN_SUFFIX: 'a1b2' };
  const r = spawnSync(process.execPath, [BIN, 'scan', '--mode', 'deep', '--cwd', work, '--json'], { cwd: work, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout).result;
  const runs = join(work, '.ts-optimize', 'runs');
  const cands = readFileSync(join(runs, readdirSync(runs).sort().pop(), 'raw', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const seeds = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'F01-plain-npm-ts', 'SEEDS.json'), 'utf8'));
  const mine = (x) => ['struct-06', 'struct-07', 'type-03'].includes(x.rule);
  const got = cands.filter(mine);
  assert.deepEqual(got.map((c) => `${c.rule}:${c.file}:${c.line}`).sort(), seeds.must_fire.filter(mine).map((s) => `${s.rule}:${s.file}:${s.line}`).sort());
  for (const s of seeds.must_not_fire.filter(mine)) assert.ok(!got.some((c) => c.rule === s.rule && c.file === s.file && (s.line === undefined || c.line === s.line)), `decoy fired ${s.rule} ${s.file}`);
  const cn = got.filter((c) => c.rule === 'struct-07');
  assert.equal(cn.length, 3);
  assert.ok(cn.every((c) => c.symbol === 'cn' && c.identical_bodies && c.consumers.length === 1 && c.consumers[0] === 'src/index.ts'));
  assert.equal(res.counts.by_rule['struct-07'], 3);
});
