// Phase 2 acceptance rows 2.1, 2.2, 2.4, 2.6, 2.7, 2.8, 2.10, 2.12 (everything that does not need a live model).
// Live rows (2.3 parallel triagers, 2.5 prompt injection, 2.9 hook in a real session) are in tests/transcripts + LEDGER.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { compareSeeds } from './harness/seeds.mjs';
import { protectedPaths } from '../lib/detect/packs.mjs';
import { detect } from '../lib/detect/index.mjs';

process.env.TSOPT_NS = 'triage';
const BIN = join(REPO, 'bin', 'ts-opt');
const HOME = join(DEV, 'home');
const ENV = { ...process.env, TS_OPT_HOME: HOME };
const cli = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const json = (args, cwd) => { const r = cli([...args, '--json'], cwd); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr }; };
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const latest = (work) => { const d = join(work, '.ts-optimize', 'runs'); return join(d, readdirSync(d).map((r) => [r, JSON.parse(readFileSync(join(d, r, 'run.json'), 'utf8')).created]).sort((a, b) => (a[1] < b[1] ? -1 : 1)).pop()[0]); };
const cands = (work) => lines(join(latest(work), 'raw', 'candidates.jsonl'));
const scan = (work, extra = []) => { const r = json(['scan', '--cwd', work, '--quiet', '--abandon-open', ...extra], work); assert.equal(r.status, 0, r.stderr); return r.out.result; };
const verdict = (work, id, args) => cli(['verdict', 'add', '--cwd', work, '--candidate', id, ...args], work);

test('2.1 route-like files get the high-risk class (Next plugin switched off so Knip reports the routes)', () => {
  const src = ensureFixture('F05', { reset: true });
  const dir = join(mkdtempSync(join(tmpdir(), 'tsopt-next-')), 'p');
  cpSync(src, dir, { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(dir, 'knip.json'), JSON.stringify({ next: false }));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'knip');
  scan(dir);
  const c = cands(dir).filter((x) => x.rule === 'reach-01');
  const routes = c.filter((x) => /(^|\/)(page|layout|route)\.tsx?$/.test(x.file));
  assert.ok(routes.length >= 3, `routes reported: ${routes.map((x) => x.file)}`);
  assert.ok(routes.every((x) => x.fix_risk_hint === 'high' && x.context.route_like === true));
  const dead = c.find((x) => x.file === 'lib/legacy-format.ts');
  assert.equal(dead.fix_risk_hint, 'medium');
  rmSync(dirname(dir), { recursive: true, force: true });
});

test('2.2 F06: plat-01 severity follows each variant; registered classes and ambient files are protected', async () => {
  const work = ensureFixture('F06', { reset: true });
  scan(work);
  const cs = cands(work).filter((x) => x.rule === 'plat-01');
  const sev = Object.fromEntries(cs.map((x) => [x.file.split('/')[1], x.severity_hint]));
  assert.deepEqual(sev, { 'a-jsonc': 'advisory', 'b-toml': 'hard', 'c-json': 'hard' });
  assert.ok(cs.every((x) => x.context.pack === 'workerd'));
  const d = await detect(work);
  const prot = protectedPaths(work, d);
  for (const v of ['a-jsonc', 'b-toml', 'c-json']) {
    assert.ok(prot.some((g) => g.includes(`variants/${v}/src/counter.ts`)), `${v} Durable Object file protected`);
    assert.ok(prot.some((g) => g.includes('worker-configuration.d.ts')), 'ambient declarations protected');
  }
  assert.deepEqual(compareSeeds('F06').missing, []);
});

test('2.4 a suppression survives 10 inserted lines (stable fingerprint) and the sibling finding does not', () => {
  const work = ensureFixture('F01', { reset: true });
  scan(work);
  spawnSync(process.execPath, [join(REPO, 'tests', 'harness', 'auto-verdict.mjs'), 'F01'], { env: ENV });
  assert.equal(cli(['findings', 'ingest', '--cwd', work], work).status, 0);
  const target = lines(join(latest(work), 'raw', 'candidates.jsonl')).find((c) => c.rule === 'slop-01' && c.file === 'src/errors.ts' && c.line === 6);
  const fid = JSON.parse(readFileSync(join(latest(work), 'findings', 'index.json'), 'utf8')).findings.find((f) => f.rule === 'slop-01' && f.line === 6).id;
  assert.equal(cli(['suppress', fid, '--reason', 'intentional passthrough in a test double', '--cwd', work], work).status, 0);
  writeFileSync(join(work, 'src', 'errors.ts'), '// pad\n'.repeat(10) + readFileSync(join(work, 'src', 'errors.ts'), 'utf8'));
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'pad');
  const r = scan(work);
  assert.equal(r.suppressed, 1);
  const left = cands(work).filter((c) => c.rule === 'slop-01' && c.file === 'src/errors.ts');
  assert.equal(left.length, 1);
  assert.equal(left[0].line, 24);
  assert.ok(target);
});

test('2.6 knip-overlay --write creates the overlay, the next scan uses it, the user\'s files are untouched', () => {
  const work = ensureFixture('F06', { reset: true });
  const w = json(['knip-overlay', '--write', '--cwd', work], work);
  assert.equal(w.status, 0);
  assert.ok(existsSync(join(work, '.ts-optimize', 'knip.config.jsonc')));
  assert.ok(w.out.result.overlay.entry.some((e) => e.endsWith('counter.ts')));
  assert.ok(w.out.result.overlay.ignore.some((e) => e.endsWith('worker-configuration.d.ts')));
  scan(work);
  assert.equal(git(work, 'status', '--porcelain', '--', '.', ':!.ts-optimize').stdout.trim(), ''); // nothing of the user's changed
});

test('2.7 verdict add validates: unknown candidate, duplicate, "yes" with confirmed, certain with a non-no answer, missing codify/reason', () => {
  const work = ensureFixture('F05', { reset: true });
  scan(work);
  const c = cands(work).find((x) => x.rule === 'reach-01' && x.file === 'components/OldBanner.tsx');
  const before = readdirSync(join(latest(work), 'raw')).includes('verdicts');
  assert.equal(before, false);
  const bad = (args, re) => { const r = verdict(work, c.id, args); assert.equal(r.status, 2, args.join(' ')); assert.match(r.stderr, re); };
  bad(['--verdict', 'confirmed', '--q1', 'yes'], /must not be confirmed/);
  bad(['--verdict', 'confirmed', '--confidence', 'certain', '--q1', 'no', '--q2', 'unknown', '--q3', 'no'], /certain/);
  bad(['--verdict', 'false-positive'], /codify|reason/);
  bad(['--verdict', 'confirmed', '--q1', 'no', '--q2', 'no', '--q3', 'no', '--touch', '../outside.txt'], /outside|exist/);
  assert.equal(cli(['verdict', 'add', '--cwd', work, '--candidate', 'c-9999', '--verdict', 'confirmed'], work).status, 2);
  assert.ok(!existsSync(join(latest(work), 'raw', 'verdicts')), 'nothing written by rejected calls');
  const ok = verdict(work, c.id, ['--verdict', 'confirmed', '--confidence', 'likely', '--q1', 'no', '--q2', 'no', '--q3', 'no', '--evidence', 'rg -w OldBanner → 0 hits']);
  assert.equal(ok.status, 0, ok.stderr);
  const dup = verdict(work, c.id, ['--verdict', 'confirmed', '--q1', 'no', '--q2', 'no', '--q3', 'no']);
  assert.equal(dup.status, 2); assert.match(dup.stderr, /already has a verdict/);
});

test('2.8 F15 decorators: entity members, DI constructor properties and decorated classes produce no dead-member findings', () => {
  const work = ensureFixture('F15', { reset: true });
  scan(work);
  const r = compareSeeds('F15');
  assert.deepEqual(r.missing, []); assert.deepEqual(r.violations, []);
  const bad = cands(work).filter((c) => ['reach-05'].includes(c.rule) && /entity|users\.(service|controller)/.test(c.file));
  assert.deepEqual(bad.map((c) => `${c.file}:${c.symbol}`), []);
});

test('2.10 codify -> overlay from verdicts -> rescan: vanished candidates are dismissed, the rest are deferred', () => {
  const work = ensureFixture('F05', { reset: true });
  scan(work);
  const by = (f) => cands(work).find((c) => c.rule === 'reach-01' && c.file === f);
  const widget = by('lib/widgets/metrics.ts'); const widget2 = by('lib/widgets/status.ts'); const wrong = by('components/OldBanner.tsx'); const dead = by('lib/legacy-format.ts');
  const fp = (c, codify) => verdict(work, c.id, ['--verdict', 'false-positive', '--confidence', 'likely', '--q1', 'no', '--q2', 'yes', '--q3', 'no', '--evidence', 'loaded via template-string import', '--reason', 'string-keyed registry', '--codify', codify]);
  assert.equal(fp(widget, 'knip: entry lib/widgets/*.ts').status, 0);
  assert.equal(fp(widget2, 'knip: entry lib/widgets/*.ts').status, 0);
  assert.equal(fp(wrong, 'knip: entry src/does-not-exist/*.ts').status, 0); // a codification that cannot work
  assert.equal(verdict(work, dead.id, ['--verdict', 'confirmed', '--confidence', 'likely', '--q1', 'no', '--q2', 'no', '--q3', 'no', '--evidence', 'rg → 0']).status, 0);
  for (const c of cands(work).filter((x) => x.triage !== 'deterministic' && ![widget, widget2, wrong, dead].some((y) => y.id === x.id))) {
    assert.equal(verdict(work, c.id, ['--verdict', 'deferred', '--reason', 'not examined in this test']).status, 0);
  }
  const ov = json(['knip-overlay', '--from-verdicts', '--write', '--cwd', work], work);
  assert.equal(ov.status, 0, ov.stderr);
  assert.ok(ov.out.result.overlay.entry.includes('lib/widgets/*.ts'));
  const rs = json(['scan', '--rescan-engine', 'knip', '--cwd', work, '--quiet'], work);
  assert.equal(rs.status, 0, rs.stderr);
  assert.deepEqual(rs.out.result.vanished.sort(), [widget.id, widget2.id].sort());
  assert.ok(rs.out.result.remained.includes(wrong.id));
  assert.equal(cli(['findings', 'ingest', '--cwd', work], work).status, 0);
  const idx = JSON.parse(readFileSync(join(latest(work), 'findings', 'index.json'), 'utf8'));
  assert.ok(idx.dismissed.some((x) => x.file === 'lib/widgets/metrics.ts' && /no longer reports/.test(x.reason)));
  const deferred = idx.findings.find((f) => f.file === 'components/OldBanner.tsx');
  assert.equal(deferred.verdict, 'deferred'); assert.equal(deferred.fix_mode, 'flag-only');
  const f = readFileSync(join(latest(work), 'findings', `${deferred.id}.md`), 'utf8');
  assert.match(f, /codification did not remove the finding/);
});

test('2.12 verdict status --defer-missing marks never-judged candidates deferred', () => {
  const work = ensureFixture('F02', { reset: true });
  scan(work);
  const st = json(['verdict', 'status', '--defer-missing', '--reason', 'triage incomplete', '--cwd', work], work);
  assert.equal(st.status, 0);
  assert.ok(st.out.result.deferred_missing > 0);
  const again = json(['verdict', 'status', '--cwd', work], work);
  assert.equal(again.out.result.pending, 0);
  assert.equal(cli(['findings', 'ingest', '--cwd', work], work).status, 0);
  const idx = JSON.parse(readFileSync(join(latest(work), 'findings', 'index.json'), 'utf8'));
  assert.ok(idx.findings.some((f) => f.verdict === 'deferred' && f.fix_mode === 'flag-only'));
});
