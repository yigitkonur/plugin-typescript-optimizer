// Structure engine (lib/engines/structure.mjs): struct-08 micro-file sprawl, struct-09 complexity hotspot, reach-11 dual abstraction.
// Every case under tests/fixtures/rules/{struct-08,struct-09,reach-11}/<case>/ is a tiny repo; expect.json lists which cases must fire.
// Run: node --test tests/structure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './harness/fixture.mjs';
import { DEFAULTS } from '../lib/artifacts/config.mjs';
import { loadRules } from '../lib/catalog/index.mjs';
import { countParams, findFunctions, handles, measureBody, name, run } from '../lib/engines/structure.mjs';
import { ENGINES } from '../lib/engines/index.mjs';

process.env.TSOPT_NS = 'structure';
const RULES = loadRules();
const DIR = join(REPO, 'tests', 'fixtures', 'rules');
const walk = (dir, rel = '') => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? walk(dir, rel ? `${rel}/${n}` : n) : [rel ? `${rel}/${n}` : n]));

function ctxFor(id, caseName, extra = {}) {
  const root = join(DIR, id, caseName);
  const files = walk(root).filter((f) => /\.[cm]?[jt]sx?$/.test(f)).sort();
  return {
    root, files, scope: { files, all_files: files }, rules: [RULES.get(id)], config: { ...DEFAULTS }, mode: 'deep',
    detect: { packages: [{ path: '.', name: 'fixture', has_package_json: true, root_only: false }], frameworks: [], engines: {}, lint: { engine: null }, ...extra },
  };
}
const expectOf = (id) => JSON.parse(readFileSync(join(DIR, id, 'expect.json'), 'utf8'));

test('registry: handles the three adapters and is registered', () => {
  assert.equal(name, 'structure');
  for (const id of ['struct-08', 'struct-09', 'reach-11']) assert.ok(handles(RULES.get(id)), id);
  assert.ok(!handles(RULES.get('struct-01')));
  assert.ok(ENGINES.includes(ENGINES.find((e) => e.name === 'structure')));
  for (const id of ['struct-08', 'struct-09', 'reach-11']) assert.ok(ENGINES.filter((e) => e.handles(RULES.get(id))).length === 1, `${id} has exactly one engine`);
});

test('struct-08: deep chain and a micro-file with one importer fire, depth 3 and two importers stay silent', async () => {
  const exp = expectOf('struct-08');
  for (const [c, clusters] of Object.entries(exp.engine_fire)) {
    const { candidates } = await run(ctxFor('struct-08', c));
    assert.deepEqual(candidates.map((x) => x.cluster), clusters, c);
    const k = candidates[0];
    assert.deepEqual([k.rule, k.grain, k.severity_hint, k.fix_mode_hint, k.engine, k.package], ['struct-08', 'package', 'advisory', 'assisted', 'fs:micro-sprawl', '.']);
    assert.ok(k.members.length > 0 && k.file === k.members[0]);
  }
  for (const c of exp.engine_silent) assert.deepEqual((await run(ctxFor('struct-08', c))).candidates, [], c);
  const deep = (await run(ctxFor('struct-08', 'deep-fire'))).candidates[0];
  assert.equal(deep.signals.max_depth, 6);
  const micro = (await run(ctxFor('struct-08', 'micro-fire'))).candidates[0];
  assert.deepEqual(micro.signals.micro_files.map((m) => [m.file, m.importer]), [['src/hooks/useCard.ts', 'src/components/Card.ts']]);
});

test('struct-08: test and generated files are never members', async () => {
  const c = ctxFor('struct-08', 'micro-fire');
  const { candidates } = await run(c);
  assert.ok(!candidates[0].members.some((m) => /\.test\./.test(m)));
  const gen = { ...c, files: c.files.map((f) => f.replace('hooks/useCard.ts', 'generated/useCard.ts')) };
  gen.scope = { files: gen.files, all_files: gen.files };
  assert.deepEqual((await run(gen)).candidates, []);
});

test('struct-09 fallback: the deep 68-line function fires, straight and masked ones stay silent', async () => {
  const exp = expectOf('struct-09');
  for (const [c, want] of Object.entries(exp.engine_fire)) {
    const { candidates, notes } = await run(ctxFor('struct-09', c));
    assert.deepEqual(candidates.map((x) => ({ file: x.file, symbol: x.symbol, line: x.line })), want, c);
    const k = candidates[0];
    assert.deepEqual([k.rule, k.grain, k.severity_hint, k.fix_mode_hint, k.engine, k.wave], ['struct-09', 'symbol', 'advisory', 'flag-only', 'lint:complexity:fallback', null]);
    assert.deepEqual(k.metrics, { cyclomatic: 7, cognitive: 16, nesting: 5, loc: 68, params: 2 });
    assert.deepEqual(k.breaches, ['cognitive', 'function_loc', 'nesting']);
    assert.equal(notes.complexity.engine, 'fallback');
  }
  for (const c of exp.engine_silent) assert.deepEqual((await run(ctxFor('struct-09', c))).candidates, [], c);
});

test('struct-09: measures, thresholds from config and the per-package cap', async () => {
  assert.equal(countParams(''), 0);
  assert.equal(countParams('a: number, { b, c }: { b: number; c: Map<string, number> }, cb = (x) => x, ...rest: string[]'), 4);
  assert.deepEqual(measureBody('if (a && b || c) { for (;;) { x ? 1 : 2; } } else { y(); }'), { cyclomatic: 6, cognitive: 9, nesting: 2 });
  const fns = findFunctions('class A { run(a, b) { return 1; } }\nconst f = async (x: number): Promise<void> => { if (x) {} };\nfunction g(p) { if (p) { return; } }\nitems.map((i) => { return i; });\n');
  assert.deepEqual(fns.map((f) => f.name), ['run', 'f', 'g']);
  // thresholds come from config: a 20-line cap catches the straight 28-line function
  const c = ctxFor('struct-09', 'silent');
  c.config = { thresholds: { ...DEFAULTS.thresholds, function_loc: 20 } };
  const { candidates } = await run(c);
  assert.deepEqual(candidates.map((x) => x.symbol), ['straight']);
  const many = ctxFor('struct-09', 'fire'); many.config = { thresholds: { ...DEFAULTS.thresholds, cyclomatic: 1, cognitive: 1, nesting: 99, function_loc: 999 } };
  assert.equal((await run(many)).candidates[0].priority, true);
});

test('struct-09: a failing lint engine falls back silently and says so in notes', async () => {
  const c = ctxFor('struct-09', 'fire', { lint: { engine: 'eslint' }, engines: { eslint: { works: true, bin: '/nonexistent/eslint', version: '9.0.0' } } });
  const { candidates, notes } = await run(c);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].engine, 'lint:complexity:fallback');
  assert.equal(notes.complexity.engine, 'fallback');
  assert.match(notes.complexity.lint_failed, /\S/);
  const unusable = await run(ctxFor('struct-09', 'fire', { lint: { engine: 'biome' }, engines: { biome: { works: false } } }));
  assert.equal(unusable.candidates[0].engine, 'lint:complexity:fallback');
  assert.match(unusable.notes.complexity.lint_unusable, /biome/);
});

test('reach-11: competing libraries and shadow directories fire once per cluster', async () => {
  const exp = expectOf('reach-11');
  for (const [c, symbols] of Object.entries(exp.engine_fire)) {
    const { candidates } = await run(ctxFor('reach-11', c));
    assert.deepEqual(candidates.map((x) => x.symbol), symbols, c);
    const k = candidates[0];
    assert.deepEqual([k.rule, k.grain, k.severity_hint, k.fix_mode_hint, k.engine], ['reach-11', 'project', 'advisory', 'assisted', 'fs:dual-abstraction']);
  }
  for (const c of exp.engine_silent) assert.deepEqual((await run(ctxFor('reach-11', c))).candidates, [], c);
  const ax = (await run(ctxFor('reach-11', 'axios-ky-fire'))).candidates[0];
  assert.deepEqual([ax.file, ax.line, ax.survivor, ax.libraries], ['package.json', 5, 'axios', [{ name: 'axios', call_sites: 2 }, { name: 'ky', call_sites: 1 }]]);
  assert.deepEqual(ax.consumers, ['src/c.ts']);
});
