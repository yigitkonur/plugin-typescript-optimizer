// Phase 4a acceptance rows 4.1, 4.3, 4.6, 4.9 (fit part) and 4.10. Needs the fixtures F07/F08/F12 materialised and the dev
// toolbox with the native compiler (~/.cache/ts-optimize-dev/home/toolbox-native); run with `node --test tests/fit.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO, ensureFixture, fixtureDir } from './harness/fixture.mjs';
import { compareSeeds } from './harness/seeds.mjs';

process.env.TSOPT_NS = 'fit'; // own fixture copies: test files run in parallel
const BIN = join(REPO, 'bin', 'ts-opt');
const DEV_HOME = join(homedir(), '.cache', 'ts-optimize-dev', 'home');
const cli = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: DEV_HOME, ...env } });
const seeds = (id) => JSON.parse(readFileSync(join(fixtureDir(id), 'SEEDS.json'), 'utf8'));
const fitJson = (dir, env) => { const r = cli(['fit', '--json', '--cwd', dir], dir, env); return { r, env: JSON.parse(r.stdout) }; };

test('4.1 F08: verdict needs-config; every removed option at its SEEDS file:line; tooling and CI found; both compilers timed', () => {
  const dir = ensureFixture('F08', { reset: true });
  const { r, env } = fitJson(dir);
  assert.equal(r.status, 0, r.stderr);
  const fit = env.result;
  assert.equal(fit.verdict, 'needs-config');
  assert.equal(fit.schema, 'ts-optimize/fit@1');
  const p = fit.packages[0];

  // removed options: exactly the tc-01 seeds, same file and line
  const want = seeds('F08').must_fire.filter((s) => s.rule === 'tc-01').map((s) => `${s.file}:${s.line}`).sort();
  assert.deepEqual(p.removed_options.map((o) => `${o.file}:${o.line}`).sort(), want);
  assert.deepEqual(p.removed_options.map((o) => o.option).sort(), ['baseUrl', 'downlevelIteration', 'moduleResolution', 'target']);
  assert.ok(!p.removed_options.some((o) => o.line === 4 || o.line === 11 || o.line === 14), 'module, strict and outDir are not removed options');
  assert.deepEqual(Object.fromEntries(p.removed_options.map((o) => [o.option, o.code])), { target: 'TS5108', moduleResolution: 'TS5108', baseUrl: 'TS5102', downlevelIteration: 'TS5102' });
  assert.ok(p.baseurl_imports.some((b) => b.file === 'src/cli.ts' && b.line === 1 && b.spec === 'utils/format'));

  // ecosystem: ts-node, the ts-morph script, typescript-eslint
  const eco = Object.fromEntries(fit.ecosystem.map((h) => [h.id, h]));
  assert.ok(eco['ts-node'].evidence.some((e) => e.file === 'package.json' && e.kind === 'script'));
  assert.ok(eco['ts-morph'].evidence.some((e) => e.file === 'scripts/rename.ts' && e.line === 1 && e.kind === 'import'));
  assert.ok(eco['typescript-eslint'].evidence.some((e) => e.file === 'package.json' && e.line === 20));
  assert.equal(eco['typescript-eslint'].severity, 'hard');
  assert.ok(!fit.ecosystem.some((h) => h.evidence.some((e) => e.file === 'package.json' && e.line === 19)), 'typescript itself is not a consumer');

  // CI: the NODE_OPTIONS flag at ci.yml:5, advisory with the caveat
  const ci = fit.ci.find((c) => c.kind === 'node-options-worker-flag');
  assert.deepEqual([ci.file, ci.line, ci.severity], ['.github/workflows/ci.yml', 5, 'advisory']);
  assert.match(ci.claim, /verify in your CI/);

  // both compilers timed; fast_single present for the native compiler
  assert.equal(p.authoritative.kind, 'js');
  assert.equal(p.fast.kind, 'native');
  for (const k of ['auth', 'fast', 'fast_single']) assert.ok(p.ms[k] > 0, `ms.${k} = ${p.ms[k]}`);
  assert.equal(p.diag_equal, false);
  assert.ok(p.only_native.some((d) => d.code === 'TS5108' && d.category === 'removed-option'));
  assert.equal(p.divergence.unexplained, 0);

  // files and next action
  for (const f of ['fit.json', 'tsgo-fit.md']) assert.ok(existsSync(join(dir, '.ts-optimize', 'fit', 'latest', f)), f);
  assert.equal(env.next_actions[0].cmd, 'ts-opt scan --mode tsgo');
  assert.deepEqual(readdirSync(join(dir, '.ts-optimize', 'fit')), ['latest'], 'scratch configs are cleaned up');
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.slice(3).startsWith('.ts-optimize/'));
  assert.deepEqual(dirty, [], 'the project is untouched (only .ts-optimize/ was written)');
});

test('4.10 the report has measured speed-ups only and no vendor figures', () => {
  const dir = ensureFixture('F08', {});
  const report = readFileSync(join(dir, '.ts-optimize', 'fit', 'latest', 'tsgo-fit.md'), 'utf8');
  const fit = JSON.parse(readFileSync(join(dir, '.ts-optimize', 'fit', 'latest', 'fit.json'), 'utf8'));
  const p = fit.packages[0];
  assert.match(report, /## Verdict: needs-config/);
  assert.match(report, /tsconfig\.json:3/);
  assert.match(report, /\.github\/workflows\/ci\.yml:5/);
  assert.ok(report.includes(`${p.speedup.fast_vs_auth}x (${p.ms.auth} ms vs ${p.ms.fast} ms)`), 'the speed-up is computed from the recorded timings');
  // every "<n>x" figure in the report is the measured one; no ranges, no "faster", no memory numbers
  const figures = [...report.matchAll(/(\d+(?:\.\d+)?)\s?[x×](?![a-z0-9])/gi)].map((m) => Number(m[1]));
  assert.ok(figures.length >= 1 && figures.every((n) => n === p.speedup.fast_vs_auth), `figures: ${figures}`);
  assert.doesNotMatch(report, /\b\d+\s*[-–]\s*\d+\s*[x×]/);
  assert.doesNotMatch(report, /faster than|times faster|\bGB\b|\bMB\b/i);
  assert.match(report, /single-threaded/);
});

test('4.1b scan --mode tsgo on F08 reproduces every SEEDS entry through the fit engine, and standard scans never run it', () => {
  const dir = ensureFixture('F08', { reset: true });
  const s = cli(['scan', '--mode', 'tsgo', '--json', '--cwd', dir], dir);
  assert.equal(s.status, 0, s.stderr);
  const res = compareSeeds('F08');
  assert.deepEqual([res.missing.length, res.wrongLine.length, res.violations.length], [0, 0, 0], JSON.stringify(res.missing.concat(res.wrongLine, res.violations)));
  assert.equal(res.must_fire, 13);
  const std = cli(['scan', '--mode', 'standard', '--cwd', dir, '--abandon-open'], dir);
  assert.equal(std.status, 0, std.stderr);
  assert.doesNotMatch(std.stderr, /\[scan\] fit:/);
});

test('4.3 F07: already-native, the fast compiler is its own tsc 7, parity is n/a', () => {
  const dir = ensureFixture('F07', { reset: true });
  const { r, env } = fitJson(dir);
  assert.equal(r.status, 0, r.stderr);
  const fit = env.result; const p = fit.packages[0];
  assert.equal(fit.verdict, 'already-native');
  assert.equal(p.authoritative.kind, 'native');
  assert.equal(p.authoritative.version, '7.0.2');
  assert.equal(p.fast.source, 'project');
  assert.equal(p.fast.bin, p.authoritative.bin);
  assert.ok(p.fast.bin.endsWith(join('node_modules', '.bin', 'tsc')));
  assert.equal(p.diag_equal, null);
  assert.equal(p.speedup, null);
  assert.ok(p.ms.auth > 0 && p.ms.fast_single > 0);
  assert.deepEqual(p.removed_options, []);
  // the one thing wrong around it: typescript-eslint (SEEDS: tc-04 at package.json:18)
  assert.deepEqual(fit.packages[0].blockers.map((b) => [b.rule, b.file, b.line]), [['tc-04', 'package.json', 18]]);
  assert.deepEqual(fit.ci, []);
  const st = cli(['fit', '--status', '--json', '--cwd', dir], dir);
  const s = JSON.parse(st.stdout).result;
  assert.equal(s.last.verdict, 'already-native');
  assert.equal(s.compilers[0].authoritative.kind, 'native');
  const sc = cli(['scan', '--mode', 'tsgo', '--cwd', dir], dir);
  assert.equal(sc.status, 0, sc.stderr);
  const res = compareSeeds('F07');
  assert.deepEqual([res.missing.length, res.wrongLine.length, res.violations.length], [0, 0, 0]);
});

test('4.6 no native compiler anywhere: cannot-probe, exit 4, still printed, exactly one next action, static findings kept', () => {
  const src = ensureFixture('F08', { reset: true });
  const dir = join(mkdtempSync(join(tmpdir(), 'tsopt-fit-np-')), 'F08');
  cpSync(src, dir, { recursive: true, filter: (f) => !/\/node_modules(\/|$)/.test(f) });
  symlinkSync(join(src, 'node_modules'), join(dir, 'node_modules'));
  const emptyHome = mkdtempSync(join(tmpdir(), 'tsopt-fit-home-'));
  const env = { TS_OPT_HOME: emptyHome, PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':') };
  try {
    const r = cli(['fit', '--json', '--cwd', dir], dir, env);
    assert.equal(r.status, 4, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.result.verdict, 'cannot-probe');
    assert.match(out.result.cannot_probe_reason, /no native compiler/);
    assert.equal(out.next_actions.length, 1);
    assert.match(out.next_actions[0].cmd, /toolbox install --native --yes/);
    const p = out.result.packages[0];
    assert.equal(p.fast, null);
    assert.equal(p.ms.fast, null);
    assert.equal(p.removed_options.length, 4, 'the static pass still ran');
    assert.ok(existsSync(join(dir, '.ts-optimize', 'fit', 'latest', 'fit.json')));
    // text mode prints too
    const t = cli(['fit', '--cwd', dir], dir, env);
    assert.equal(t.status, 4);
    assert.match(t.stdout, /fit verdict: cannot-probe/);
    // the scan engine degrades the probe-dependent rules instead of failing
    const sc = cli(['scan', '--mode', 'tsgo', '--json', '--cwd', dir], dir, env);
    assert.equal(sc.status, 0, sc.stderr);
    const degraded = JSON.parse(sc.stdout).result.degraded.map((x) => x.part);
    assert.ok(degraded.includes('tc-03') && degraded.includes('tc-11'), degraded.join());
  } finally { rmSync(dirname(dir), { recursive: true, force: true }); rmSync(emptyHome, { recursive: true, force: true }); }
});

test('4.9 F12 (allowJs/checkJs): the native compiler\'s JS differences are found and attributed to tc-09; seeds hold', () => {
  const dir = ensureFixture('F12', { reset: true });
  const { r, env } = fitJson(dir);
  assert.equal(r.status, 0, r.stderr);
  const p = env.result.packages[0];
  assert.ok(p.js_constructs.hits >= 8, JSON.stringify(p.js_constructs));
  assert.ok(p.only_native.some((d) => d.category === 'jsdoc' && /registry\.js$/.test(d.file)));
  assert.equal(p.divergence.unexplained, 0);
  assert.ok(p.blockers.some((b) => b.rule === 'tc-09' && /registry\.js$/.test(b.file)));
  const sc = cli(['scan', '--mode', 'tsgo', '--cwd', dir], dir);
  assert.equal(sc.status, 0, sc.stderr);
  const res = compareSeeds('F12');
  assert.deepEqual([res.missing.length, res.wrongLine.length, res.violations.length], [0, 0, 0], JSON.stringify(res.violations));
});

test('tc-12 (T3 engine switch): reported for a ready JavaScript-compiler package with nothing needing the API; silent with a tc-04 hit or a native compiler', async () => {
  const { candidatesFromFit } = await import('../lib/engines/fit.mjs');
  const { loadRules } = await import('../lib/catalog/index.mjs');
  const rules = loadRules();
  const pkg = (over = {}) => ({ path: '.', verdict: 'ready', authoritative: { kind: 'js', version: '5.9.3' }, declares_typescript: { file: 'package.json', line: 12, field: 'devDependencies', range: '^5.9.3' }, removed_options: [], paths_issues: [], baseurl_imports: [], default_exposure: [], only_native: [], only_authoritative: [], ...over });
  const fitOf = (p, ecosystem = []) => ({ packages: [p], ecosystem, ci: [], editor: [], references: null });
  const rulesOf = (fit) => candidatesFromFit(fit, rules).map((c) => c.rule);
  const hit = candidatesFromFit(fitOf(pkg()), rules).filter((c) => c.rule === 'tc-12');
  assert.equal(hit.length, 1);
  assert.deepEqual([hit[0].file, hit[0].line, hit[0].package], ['package.json', 12, '.']);
  assert.match(hit[0].snippet, /"typescript": "\^5\.9\.3" resolves to 5\.9\.3/);
  assert.ok(!rulesOf(fitOf(pkg(), [{ broken: true, rule: 'tc-04', package: '.', evidence: [] }])).includes('tc-12'), 'the alias scheme (tc-04) already performs the switch');
  assert.ok(!rulesOf(fitOf(pkg({ authoritative: { kind: 'native', version: '7.0.2' } }))).includes('tc-12'));
  assert.ok(!rulesOf(fitOf(pkg({ verdict: 'blocked' }))).includes('tc-12'));
  assert.ok(!rulesOf(fitOf(pkg({ declares_typescript: null }))).includes('tc-12'), 'no typescript line to edit');
});
