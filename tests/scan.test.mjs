// Phase 1 acceptance rows 1.1–1.15 (audit core). Needs fixtures materialised by tests/harness/fixture.mjs and the dev toolbox
// (`TS_OPT_HOME=~/.cache/ts-optimize-dev/home ts-opt toolbox install --yes`). Run: node --test tests/scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { compareSeeds } from './harness/seeds.mjs';
import { normalizeKnip } from '../lib/engines/knip.mjs';

process.env.TSOPT_NS = 'scan'; // own fixture copies: test files run in parallel
const BIN = join(REPO, 'bin', 'ts-opt');
const HOME = join(DEV, 'home');
const ENV = { ...process.env, TS_OPT_HOME: HOME, TS_OPT_NOW: '2026-10-19T14:32:00Z', TS_OPT_RUN_SUFFIX: 'a1b2' };
const cli = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const json = (args, cwd, env) => { const r = cli([...args, '--json'], cwd, env); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr }; };
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const runDirOf = (work) => { const d = join(work, '.ts-optimize', 'runs'); return join(d, readdirSync(d).sort().pop()); };
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const golden = (n) => JSON.parse(readFileSync(join(REPO, 'tests', 'golden', n), 'utf8'));
const project = (c) => ({ rule: c.rule, file: c.file, line: c.line, symbol: c.symbol, engine: c.engine.replace(/@[\d.]+/, '@V'), consumers: c.consumers ?? [] });
function auditF01(extra = []) {
  const work = ensureFixture('F01', { reset: true });
  const s = json(['scan', '--cwd', work, '--quiet', ...extra], work);
  assert.equal(s.status, 0, s.stderr);
  return { work, scan: s.out.result };
}
function judgeAndIngest(work, id = 'F01') {
  const r = spawnSync(process.execPath, [join(REPO, 'tests', 'harness', 'auto-verdict.mjs'), id], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  const i = cli(['findings', 'ingest', '--cwd', work], work);
  assert.equal(i.status, 0, i.stderr);
}

test('1.1 F01 sweep: seeded sweep rules fire, no decoy fires, golden candidates', () => {
  const { work, scan } = auditF01(['--mode', 'sweep']);
  assert.ok(scan.counts.total > 0);
  const cands = lines(join(runDirOf(work), 'raw', 'candidates.jsonl'));
  assert.deepEqual(new Set(cands.map((c) => c.rule)), new Set(['reach-01', 'slop-01', 'slop-03']));
  const seeds = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'F01-plain-npm-ts', 'SEEDS.json'), 'utf8'));
  for (const s of seeds.must_fire.filter((x) => ['reach-01', 'slop-01', 'slop-03'].includes(x.rule))) assert.ok(cands.some((c) => c.rule === s.rule && c.file === s.file && c.line === s.line), `missing ${s.rule} ${s.file}:${s.line}`);
  for (const s of seeds.must_not_fire.filter((x) => ['reach-01', 'slop-01', 'slop-03'].includes(x.rule))) assert.ok(!cands.some((c) => c.rule === s.rule && c.file === s.file && (s.line === undefined || c.line === s.line)), `decoy fired ${s.rule} ${s.file}:${s.line}`);
  assert.deepEqual(cands.map(project), golden('F01-scan-sweep.json'));
});

test('1.1b F01 standard: every Phase-1 seed fires on the seeded line; precision engines emit no decoy', () => {
  const { work } = auditF01();
  const r = compareSeeds('F01', undefined, {});
  const phase1 = r.missing.filter((m) => !['struct-03', 'struct-07'].includes(m.rule)); // deep-mode rules (Phase 5)
  assert.deepEqual(phase1, []);
  assert.deepEqual(r.wrongLine, []);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(lines(join(runDirOf(work), 'raw', 'candidates.jsonl')).map(project), golden('F01-scan-standard.json'));
});

test('1.2 determinism: two audits with the same verdict input are byte-identical', () => {
  const grab = () => {
    const work = ensureFixture('F01', { reset: true });
    assert.equal(cli(['scan', '--cwd', work, '--quiet'], work).status, 0);
    judgeAndIngest(work);
    const rd = runDirOf(work);
    const out = {};
    for (const f of readdirSync(join(rd, 'findings'))) out[`findings/${f}`] = readFileSync(join(rd, 'findings', f), 'utf8');
    out['plan.md'] = readFileSync(join(rd, 'plan.md'), 'utf8');
    out['SUMMARY.md'] = readFileSync(join(rd, 'SUMMARY.md'), 'utf8');
    return out;
  };
  const a = grab(); const b = grab();
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], `${k} differs between runs`);
});

test('1.3 validate: corrupt finding -> exit 8 naming the field; schema @99 -> incompatible', () => {
  const { work } = auditF01();
  judgeAndIngest(work);
  assert.equal(cli(['validate', '--cwd', work], work).status, 0);
  const rd = runDirOf(work);
  const f = join(rd, 'findings', 'F-0001.md');
  const orig = readFileSync(f, 'utf8');
  writeFileSync(f, orig.replace(/^severity: \w+$/m, 'severity: catastrophic'));
  let r = cli(['validate', '--cwd', work], work);
  assert.equal(r.status, 8); assert.match(r.stderr + r.stdout, /severity/);
  writeFileSync(f, orig.replace('ts-optimize/finding@1', 'ts-optimize/finding@99'));
  r = cli(['validate', '--cwd', work], work);
  assert.equal(r.status, 8); assert.match(r.stderr + r.stdout, /incompatible/);
  writeFileSync(f, orig);
});

test('1.4 an audit changes only .ts-optimize/ (git status), with the generated .gitignore', () => {
  const { work } = auditF01();
  judgeAndIngest(work);
  const st = git(work, 'status', '--porcelain').stdout.trim().split('\n');
  assert.deepEqual(st, ['?? .ts-optimize/']);
  const gi = readFileSync(join(work, '.ts-optimize', '.gitignore'), 'utf8');
  for (const l of ['state/', '.cache/', 'runs/*/raw/', 'runs/*/apply/gate/']) assert.ok(gi.includes(l), l);
  assert.equal(git(work, 'status', '--porcelain', '--', '.', ':!.ts-optimize').stdout.trim(), '');
});

test('1.5 Knip noise gate: >25% of files unused with no config -> one reach-12, noisy batches withheld', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'tsopt-gate-')), 'p');
  mkdirSync(join(dir, 'handlers'), { recursive: true }); mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gate', version: '1.0.0', main: 'src/main.ts', devDependencies: { typescript: '5.9.3' } }));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src', 'handlers'] }));
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const load = (n: string) => import(`../handlers/${n}.ts`);\n');
  for (let i = 1; i <= 6; i++) writeFileSync(join(dir, 'handlers', `h${i}.ts`), `export default function h${i}() { return ${i}; }\n`);
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x');
  const r = json(['scan', '--cwd', dir, '--quiet'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.result.noise_gate.tripped, true);
  const cands = lines(join(runDirOf(dir), 'raw', 'candidates.jsonl'));
  assert.equal(cands.filter((c) => c.rule === 'reach-12').length, 1);
  assert.equal(cands.filter((c) => c.rule === 'reach-01').length, 0);
  assert.ok(lines(join(runDirOf(dir), 'raw', 'withheld.jsonl')).length >= 6);
  rmSync(dirname(dir), { recursive: true, force: true });
});

test('1.6 type-coverage cannot run under TypeScript 7 -> proxy metric escape-hatch@1, degraded and why', () => {
  const src = ensureFixture('F07', { reset: true });
  const dir = join(mkdtempSync(join(tmpdir(), 'tsopt-ts7-')), 'p');
  cpSync(src, dir, { recursive: true });
  const ins = spawnSync('npm', ['install', '--save-dev', '--save-exact', 'type-coverage@2.30.4', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8' });
  assert.equal(ins.status, 0, ins.stderr);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'tc');
  const empty = mkdtempSync(join(tmpdir(), 'tsopt-nohome-'));
  const r = json(['scan', '--cwd', dir, '--quiet'], dir, { TS_OPT_HOME: empty });
  assert.equal(r.status, 0, r.stderr);
  const deg = r.out.result.degraded.find((d) => d.part === 'type-coverage');
  assert.ok(deg, 'degradation recorded'); assert.match(deg.reason, /does not export|compiler api|createProgram/i); assert.match(deg.reason, /escape-hatch@1/);
  const metrics = JSON.parse(readFileSync(join(runDirOf(dir), 'raw', 'metrics.json'), 'utf8'));
  assert.equal(metrics[0].metric, 'escape-hatch@1');
  rmSync(dirname(dir), { recursive: true, force: true });
});

test('1.7 --diff limits scope to changed files and skips dead-code engines', () => {
  const work = ensureFixture('F01', { reset: true });
  writeFileSync(join(work, 'src', 'laundering.ts'), readFileSync(join(work, 'src', 'laundering.ts'), 'utf8') + '\nexport const extra = JSON.parse("1") as any;\n');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'change');
  const r = json(['scan', '--cwd', work, '--quiet', '--diff=HEAD~1'], work);
  assert.equal(r.status, 0, r.stderr);
  const cands = lines(join(runDirOf(work), 'raw', 'candidates.jsonl'));
  assert.ok(cands.length > 0);
  assert.ok(cands.every((c) => c.file === 'src/laundering.ts' || c.engine.startsWith('tsconfig') || c.engine.startsWith('coverage')), JSON.stringify(cands.map((c) => c.file + ' ' + c.engine)));
  assert.ok(!cands.some((c) => c.engine.startsWith('knip')));
  assert.equal(r.out.result.diff.base, 'HEAD~1');
});

test('1.11 Knip adapter: recorded v5 and v6 outputs normalise to the same issue set', () => {
  const key = (i) => `${i.type}|${i.file}|${i.name ?? ''}`;
  const v5 = normalizeKnip(golden('knip-v5-F01.json')).map(key).sort();
  const v6 = normalizeKnip(golden('knip-v6-F01.json')).map(key).sort();
  assert.deepEqual(v5, v6);
  assert.ok(v6.includes('files|src/orphan.ts|') && v6.some((k) => k.startsWith('dependencies|package.json|is-odd')));
});

test('1.12 absence: no ast-grep -> structural rules degraded, regex hits capped at "likely"; no lint engine -> auto fixes become assisted', () => {
  const bin = mkdtempSync(join(tmpdir(), 'tsopt-path-'));
  for (const t of ['node', 'git']) symlinkSync(spawnSync('which', [t], { encoding: 'utf8' }).stdout.trim(), join(bin, t)); // no rg, no ast-grep
  const empty = mkdtempSync(join(tmpdir(), 'tsopt-nohome-'));
  const work = ensureFixture('F13', { reset: true });
  const r = json(['scan', '--cwd', work, '--quiet'], work, { PATH: bin, TS_OPT_HOME: empty });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.out.result.degraded.some((d) => /ast-grep/.test(d.reason)));
  const cands = lines(join(runDirOf(work), 'raw', 'candidates.jsonl'));
  assert.ok(cands.filter((c) => ['type-01', 'type-04', 'type-08', 'type-10', 'slop-01'].includes(c.rule)).every((c) => c.tier_degraded === true));
  judgeAndIngest(work, 'F13');
  const idx = JSON.parse(readFileSync(join(runDirOf(work), 'findings', 'index.json'), 'utf8')).findings.filter((f) => f.rule === 'slop-01');
  assert.ok(idx.length > 0 && idx.every((f) => f.fix_mode === 'assisted'), JSON.stringify(idx));
});

test('1.13 F17 Vue: <script> blocks scanned with file-absolute lines; template-only consumer not reported dead', () => {
  const work = ensureFixture('F17', { reset: true });
  assert.equal(cli(['scan', '--cwd', work, '--quiet'], work).status, 0);
  const r = compareSeeds('F17');
  assert.deepEqual(r.missing, []); assert.deepEqual(r.wrongLine, []); assert.deepEqual(r.violations, []);
  const cands = lines(join(runDirOf(work), 'raw', 'candidates.jsonl'));
  assert.ok(!cands.some((c) => c.rule === 'reach-01' && /Counter\.vue|Legacy\.vue/.test(c.file)));
});

test('1.14 F18 Deno: no Node-based engines attempted, and the coverage table says why', () => {
  const work = ensureFixture('F18', { reset: true });
  const r = json(['scan', '--cwd', work, '--quiet'], work);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.out.result.degraded.some((d) => /Deno project/.test(d.reason)));
  const det = json(['detect'], work).out.result;
  assert.equal(det.gate.legs.find((l) => l.id === 'typecheck').variant, 'script'); // deno task check -> deno check
});

test('1.15 consumers/touches come from the importer index', () => {
  const { work } = auditF01();
  const c = lines(join(runDirOf(work), 'raw', 'candidates.jsonl'));
  const by = (rule, file) => c.find((x) => x.rule === rule && x.file === file);
  assert.deepEqual(by('reach-03', 'src/testonly.ts').consumers, ['test/testonly.test.ts']); // the test that imports the leaked helper
  assert.deepEqual(by('reach-04', 'src/internal.ts').consumers, []); // wrapper.ts imports a different symbol
  assert.deepEqual(by('reach-04', 'src/barrel/b.ts').consumers, ['src/barrel/index.ts']); // the barrel re-exports it
  assert.deepEqual(by('reach-02', 'src/barrel/index.ts').consumers, []); // src/index.ts imports only usedHelper
  assert.deepEqual(by('reach-01', 'src/orphan.ts').consumers, []);
});
