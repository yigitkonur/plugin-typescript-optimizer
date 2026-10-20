// Phase 3 acceptance rows driven through the real CLI (bin/ts-opt) on fixture work copies: the run lifecycle, preconditions,
// stale-check, lock, abort, the bridge wave, cascades and repeat passes, quarantine and the declaration-emit pre-check.
// The live LLM rows (3.1, 3.2, 3.3 live) are in tests/transcripts; here the model's part is played by plain file edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { allFindings, git, logEvents, readF } from './harness/applying.mjs';
import { auditFixture, latestRun } from './harness/fixrun.mjs';
import { writeFinding } from '../lib/artifacts/finding.mjs';
import { seedBreaker } from './harness/breaker.mjs';

process.env.TSOPT_NS = 'fix';
process.env.TS_OPT_HOME = join(DEV, 'home');
const BIN = join(REPO, 'bin', 'ts-opt');
const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' };

/** run the CLI; returns {status, out (stdout), err, json (parsed --json envelope or null)} */
const T = (work, ...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args, '--json', '--cwd', work], { cwd: work, encoding: 'utf8', env, timeout: 600_000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { status: r.status, out: r.stdout, err: r.stderr, json, text: `${r.stdout}${r.stderr}` };
};
const ok = (r, what = '') => { assert.equal(r.status, 0, `${what}\n${r.text.slice(0, 1500)}`); return r; };
const exit = (r, code, re) => { assert.equal(r.status, code, r.text.slice(0, 1500)); if (re) assert.match(r.text, re); return r; };
const edit = (work, rel, fn) => { const p = join(work, rel); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
const gout = (work, ...a) => git(work, ...a).stdout.trim();
const commitDirty = (work, msg) => { git(work, 'add', '-A'); const c = git(work, 'commit', '-m', msg); assert.equal(c.status, 0, c.stderr); };
const idOf = (work, runId, rule, file) => allFindings(work, runId).find((f) => f.front.rule === rule && (!file || f.front.location?.file === file)).front.id;
const config = (work, obj) => { writeFileSync(join(work, '.ts-optimize', 'config.json'), JSON.stringify(obj, null, 2) + '\n'); };

function audited(fixture = 'F01', opts = {}) {
  const work = auditFixture(fixture, opts);
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  return { work, runId: latestRun(work) };
}
const tick = (work, ...flags) => ok(T(work, 'plan', 'check', ...flags), 'plan check');
const runJson = (work, runId) => JSON.parse(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'run.json'), 'utf8'));

test('3.19 lifecycle: a full run through the CLI — preconditions, order, ledger, artifacts commit', () => {
  const { work, runId } = audited('F01');
  // lock before begin, and a second scan while the run is open
  exit(T(work, 'plan', 'lock'), 5, /ready|run begin/);
  exit(T(work, 'scan', '--quiet'), 5, /open/);
  // run finish before anything ran
  exit(T(work, 'run', 'finish'), 5, /verifying|post-flight|gate/);
  const begin = ok(T(work, 'run', 'begin'), 'run begin');
  assert.equal(begin.json.result.state, 'ready');
  assert.match(begin.json.result.branch, /^chore\/ts-cleanup/);
  // a wave cannot start before the lock ("approval always precedes any edit")
  exit(T(work, 'run', 'wave', 'begin', '3'), 5, /locked/);
  tick(work, '--rule', 'reach-04');
  const lock = ok(T(work, 'plan', 'lock'), 'plan lock');
  assert.ok(lock.json.result.approved >= 2, lock.text);
  const st = ok(T(work, 'run', 'status')).json.result;
  assert.equal(st.state, 'locked');
  assert.deepEqual(st.waves_pending.slice(0, 2), ['3', 'B'], 'wave 3 plus the implicit bridge');

  const w3 = ok(T(work, 'run', 'wave', 'begin', '3'));
  assert.ok(w3.json.result.findings.length >= 2);
  // out-of-order: the bridge cannot start while wave 3 is running
  exit(T(work, 'run', 'wave', 'begin', 'B'), 5, /still running|causal|approved/);
  // wave 3 edits (the model's part): un-export the internal-only symbols, one commit each
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  const f7 = idOf(work, runId, 'reach-04', 'src/barrel/b.ts');
  edit(work, 'src/internal.ts', (t) => t.replace('export function normalize', 'function normalize'));
  const c1 = ok(T(work, 'commit', f8, '-m', 'internalize normalize'), 'commit f8');
  assert.match(gout(work, 'log', '-1', '--format=%B'), new RegExp(`Rule: reach-04\\nFinding: ${f8}\\nRun: ${runId}\\nWave: 3\\nFast-check: pass`));
  // (a module with no export left would become a global script and tsc would not call deadHelper unused; keep b.ts a module)
  edit(work, 'src/barrel/b.ts', (t) => t.replace('export function deadHelper', 'function deadHelper') + 'export const marker = 1;\n');
  edit(work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', '')); // the consumer listed in touches
  ok(T(work, 'commit', f7, '-m', 'internalize deadHelper'), 'commit f7');
  assert.ok(c1.json.result.sha);
  ok(T(work, 'gate', '--wave', '3'), 'gate 3');
  // 3.17: the barrel no longer references b.ts, so the file is orphaned: rescan raises a cascade finding for the repeat pass
  const rs = ok(T(work, 'rescan', '--wave', '3'), 'rescan 3');
  assert.equal(rs.json.result.new_cascades.length, 1, rs.text);
  const casc = readF(work, runId, rs.json.result.new_cascades[0]);
  assert.equal(casc.front.rule, 'reach-01');
  assert.equal(casc.front.origin, `cascade:${f7}`);
  assert.equal(casc.front.state, 'open');
  assert.equal(ok(T(work, 'run', 'wave', 'end', '3')).json.result.status, 'gated');
  exit(T(work, 'run', 'wave', 'begin', '1'), 3, /no approved findings/); // not approved yet
  const amend = ok(T(work, 'plan', 'amend', '--cascade'), 'plan amend --cascade');
  assert.deepEqual(amend.json.result.amended, [casc.front.id]);
  const afterAmend = ok(T(work, 'run', 'status')).json.result;
  assert.deepEqual(afterAmend.waves_pending, ['B', '1'], 'the repeat wave runs after the regular ones');
  assert.deepEqual(afterAmend.repeat_pending, ['1']);
  exit(T(work, 'run', 'wave', 'begin', '1'), 5, /repeat pass|regular waves/);

  // bridge: un-exporting deadHelper left an unused local
  const b = ok(T(work, 'run', 'wave', 'begin', 'B'), 'wave begin B');
  assert.equal(b.json.result.wave, 'B');
  assert.equal(b.json.result.skipped, undefined, b.text);
  const bf = readF(work, runId, b.json.result.findings[0]);
  assert.equal(bf.front.rule, 'reach-06');
  assert.equal(bf.front.origin, 'bridge');
  assert.equal(bf.front.state, 'approved');
  assert.deepEqual(bf.front.touches, ['src/barrel/b.ts']);
  const lockDoc = JSON.parse(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.lock.json'), 'utf8'));
  assert.ok(lockDoc.amendments.some((a) => a.by === 'bridge' && a.ids.includes(bf.front.id)), 'the lock records the bridge');
  // the bridge edit: the project's own lint engine would do it; here the model's part is the same one-line removal
  edit(work, 'src/barrel/b.ts', (t) => t.replace(/^function deadHelper[\s\S]*?\n}\n/m, ''));
  ok(T(work, 'commit', bf.front.id, '-m', 'drop unused deadHelper'), 'commit bridge');
  ok(T(work, 'gate', '--wave', 'B'), 'gate B');
  ok(T(work, 'run', 'wave', 'end', 'B'));
  // repeat pass for the cascade: delete the orphaned file
  const w1 = ok(T(work, 'run', 'wave', 'begin', '1'), 'wave begin 1 (repeat)');
  assert.deepEqual(w1.json.result.findings, [casc.front.id]);
  ok(T(work, 'remove', casc.front.id), 'remove');
  assert.equal(existsSync(join(work, 'src/barrel/b.ts')), false);
  ok(T(work, 'commit', casc.front.id, '-m', 'delete orphaned b.ts'), 'commit cascade');
  ok(T(work, 'gate', '--wave', '1'), 'gate 1');
  ok(T(work, 'run', 'wave', 'end', '1'));
  const lk = JSON.parse(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.lock.json'), 'utf8'));
  assert.ok(lk.amendments.some((a) => a.by === 'user-confirmed' && a.ids.includes(casc.front.id)), 'the amendment is recorded in the lock');
  // nothing else was approved: post-flight, then finish
  const p = ok(T(work, 'gate', '--wave', 'P'), 'gate P');
  assert.equal(runJson(work, runId).state, 'verifying');
  const fin = ok(T(work, 'run', 'finish'), 'run finish');
  assert.equal(fin.json.result.state, 'done');
  assert.ok(existsSync(join(work, '.ts-optimize', 'runs', runId, 'apply', 'ledger.md')));
  const ledger = readFileSync(join(work, '.ts-optimize', 'runs', runId, 'apply', 'ledger.md'), 'utf8');
  assert.match(ledger, new RegExp(`\\| ${f8} \\| reach-04 \\| \`[0-9a-f]{7}\``));
  const head = gout(work, 'show', '--name-only', '--format=%s', 'HEAD').split('\n');
  assert.equal(head[0], `chore(ts-optimize): record run ${runId}`);
  assert.ok(head.slice(1).filter(Boolean).every((f) => f.startsWith('.ts-optimize/')), `artifacts commit holds only .ts-optimize/ files: ${head}`);
  ok(T(work, 'validate'), 'validate');
  assert.equal(existsSync(join(work, '.ts-optimize', 'state', 'open-run')), false, 'open-run cleared');
  void p;
});

const patchFront = (work, runId, fid, patch) => {
  const f = readF(work, runId, fid);
  Object.assign(f.front, patch);
  writeFinding(f.file, f.front, f.body);
};
const startWave = (work, runId, rule, wave, flags = []) => {
  ok(T(work, 'run', 'begin'), 'run begin');
  tick(work, '--rule', rule, ...flags);
  ok(T(work, 'plan', 'lock'), 'plan lock');
  return ok(T(work, 'run', 'wave', 'begin', wave), `wave begin ${wave}`);
};

test('3.10 F11: a stripped export that declaration emit needs is refused by the pre-check and re-expressed as "keep export"', () => {
  const { work, runId } = audited('F11');
  const fid = idOf(work, runId, 'reach-04', 'src/util.ts');
  // the model's mistake, expressed through the finding it would hide behind: Session looks internal-only but is part of open()'s signature
  patchFront(work, runId, fid, { location: { file: 'src/session.ts', line: 3, symbol: 'Session' }, touches: ['src/session.ts'] });
  startWave(work, runId, 'reach-04', '3');
  edit(work, 'src/session.ts', (t) => t.replace('export interface Session', 'interface Session'));
  const r = T(work, 'commit', fid, '-m', 'internalize Session');
  assert.equal(r.status, 7, r.text.slice(0, 1200));
  assert.match(r.text, /declaration emit of \S+ breaks|TS40\d\d|TS2742|private name/i);
  assert.match(r.text, /keep the export|public API/i);
  assert.equal(gout(work, 'log', '--oneline', '-1', '--format=%s').includes('internalize Session'), false, 'no commit was made');
  const f = readF(work, runId, fid);
  assert.equal(f.front.state, 'skipped');
  assert.equal(f.front.triage.public_contract, 'yes');
  assert.match(f.body, /re-expressed as: keep export/);
  assert.ok(logEvents(work, runId).some((e) => e.ev === 'precheck-refused' && e.id === fid));
  git(work, 'checkout', '--', 'src/session.ts');
});

test('3.22 quarantine: a routed-looking file is moved to .quarantine/<path>, committed, and listed at run finish', () => {
  const { work, runId } = audited('F01');
  const fid = idOf(work, runId, 'reach-01', 'src/orphan.ts');
  startWave(work, runId, 'reach-01', '1');
  // remove refuses a high-risk finding only; this one is medium: quarantine is still always allowed for reach-01
  const q = ok(T(work, 'quarantine', fid), 'quarantine');
  assert.deepEqual(q.json.result.moved, [{ from: 'src/orphan.ts', to: '.quarantine/src/orphan.ts' }]);
  assert.equal(existsSync(join(work, 'src/orphan.ts')), false);
  assert.equal(existsSync(join(work, '.quarantine/src/orphan.ts')), true);
  ok(T(work, 'commit', fid, '-m', 'quarantine orphan.ts'), 'commit quarantine');
  assert.equal(gout(work, 'show', '--name-status', '--format=', 'HEAD').replace(/\s+/g, ' '), 'R100 src/orphan.ts .quarantine/src/orphan.ts');
  ok(T(work, 'gate', '--wave', '1'), 'gate 1 (tsc ignores .quarantine? it is outside include)');
  ok(T(work, 'run', 'wave', 'end', '1'));
  ok(T(work, 'gate', '--wave', 'P'), 'gate P');
  ok(T(work, 'run', 'finish'), 'finish');
  const readme = readFileSync(join(work, '.quarantine', 'README.md'), 'utf8');
  assert.match(readme, /src\/orphan\.ts/);
});

test('3.5 preconditions: a dirty tree refuses run begin and lists the files; the audit commit state is untouched', () => {
  const { work } = audited('F01');
  writeFileSync(join(work, 'src', 'index.ts'), readFileSync(join(work, 'src', 'index.ts'), 'utf8') + '\n// local edit\n');
  const r = exit(T(work, 'run', 'begin'), 5, /uncommitted/);
  assert.match(r.text, /src\/index\.ts/);
  assert.equal(existsSync(join(work, '.ts-optimize', 'state', 'open-run')), true, 'the audit run stays open');
  git(work, 'checkout', '--', 'src/index.ts');
  ok(T(work, 'run', 'begin'), 'clean tree works');
});

test('3.6 F13 (no tests): plan.md says which waves can run; a wave-1 box makes plan lock refuse', () => {
  const { work, runId } = audited('F13');
  const plan = readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.md'), 'utf8');
  assert.match(plan, /Unavailable: test/);
  ok(T(work, 'run', 'begin'), 'run begin');
  const orphan = idOf(work, runId, 'reach-01', 'src/orphan.ts');
  // the finding has no wave in this run (a green test leg is required for wave 1), so it is not even eligible for a box
  const f = readF(work, runId, orphan);
  assert.equal(f.front.wave, null, 'wave 1 is not schedulable without a test leg');
  assert.doesNotMatch(plan, new RegExp(`- \\[ \\] ${orphan}`));
  // ticking it by hand in plan.md is refused at the lock
  const p = join(work, '.ts-optimize', 'runs', runId, 'plan.md');
  writeFileSync(p, readFileSync(p, 'utf8') + `\n- [x] ${orphan} reach-01 \`src/orphan.ts\` — hand-ticked\n`);
  exit(T(work, 'plan', 'lock'), 5, new RegExp(`${orphan}.*not schedulable|${orphan}`));
});

test('3.8 stale: a finding whose file changed after the audit is removed at run begin (and from plan.md)', () => {
  const { work, runId } = audited('F01');
  const fid = idOf(work, runId, 'reach-04', 'src/internal.ts');
  edit(work, 'src/internal.ts', (t) => t + '\n// edited by someone else after the audit\n');
  commitDirty(work, 'someone else edits internal.ts');
  const b = ok(T(work, 'run', 'begin'), 'run begin');
  assert.ok(b.json.result.stale.some((s) => s.id === fid && s.files.includes('src/internal.ts')), b.text);
  assert.equal(readF(work, runId, fid).front.state, 'stale');
  assert.doesNotMatch(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.md'), 'utf8'), new RegExp(`\\] ${fid}\\b`));
  tick(work, '--rule', 'reach-04');
  const lock = ok(T(work, 'plan', 'lock'));
  assert.ok(!lock.json.result.approved_ids.includes(fid), 'a stale finding is not in the lock');
});

test('3.11 two concurrent mutating commands: the second exits 5 naming the first', async () => {
  const { work } = audited('F01');
  // hold the lock the way a long gate would: start run begin (several seconds with the baseline) and race a second one
  const first = spawn(process.execPath, [BIN, 'run', 'begin', '--cwd', work], { cwd: work, env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const second = T(work, 'run', 'begin');
  await new Promise((r) => first.on('exit', r));
  assert.equal(second.status, 5, second.text.slice(0, 600));
  assert.match(second.text, /run begin is running|is running for run|another command/);
});

test('3.14 run abort: returns to the base branch when nothing was committed, keeps artifacts valid, clears the open pointer', () => {
  const { work, runId } = audited('F01');
  ok(T(work, 'run', 'begin'));
  assert.match(gout(work, 'rev-parse', '--abbrev-ref', 'HEAD'), /^chore\/ts-cleanup/);
  tick(work, '--rule', 'reach-04'); ok(T(work, 'plan', 'lock')); ok(T(work, 'run', 'wave', 'begin', '3'));
  const a = ok(T(work, 'run', 'abort', '--reason', 'changed my mind'), 'abort');
  assert.equal(a.json.result.state, 'aborted');
  assert.equal(gout(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(gout(work, 'branch', '--list', 'chore/ts-cleanup*'), '', 'the empty work branch is gone');
  assert.equal(gout(work, 'tag', '--list', `ts-optimize/${runId}/*`), '', 'untouched wave tags are gone');
  assert.equal(existsSync(join(work, '.ts-optimize', 'state', 'open-run')), false);
  ok(T(work, 'validate'), 'artifacts remain valid');
  exit(T(work, 'commit', 'F-0008'), 7, /commits need an applying run/); // nothing can be committed on an aborted run
});

test('3.20 wave B: plan.md says it is covered by wave 3; with nothing left over it is skipped and says why', () => {
  const { work, runId } = audited('F01');
  const plan = readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.md'), 'utf8');
  assert.match(plan, /## Wave B[\s\S]*covered by the approval of wave 3/);
  ok(T(work, 'run', 'begin')); tick(work, '--rule', 'reach-04'); ok(T(work, 'plan', 'lock'));
  ok(T(work, 'run', 'wave', 'begin', '3'));
  // no residue: wave 3 un-exports a symbol that is still used inside its file
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  edit(work, 'src/internal.ts', (t) => t.replace('export function normalize', 'function normalize'));
  ok(T(work, 'commit', f8, '-m', 'internalize normalize'));
  ok(T(work, 'findings', 'skip', idOf(work, runId, 'reach-04', 'src/barrel/b.ts'), '--reason', 'left for another run'));
  exit(T(work, 'run', 'wave', 'end', '3'), 5, /gate/); // gate first
  ok(T(work, 'gate', '--wave', '3')); ok(T(work, 'run', 'wave', 'end', '3'));
  const b = ok(T(work, 'run', 'wave', 'begin', 'B'), 'wave begin B');
  assert.equal(b.json.result.skipped, true);
  assert.match(b.text, /no unused-local residue/);
  assert.deepEqual(runJson(work, runId).waves.find((w) => w.id === 'B').gate, { passed: true, skipped: true, reason: 'no unused-local residue in the files this run changed' });
});

test('findings skip: an approved finding the audit got wrong leaves the apply set with its evidence; wave end then passes', () => {
  const { work, runId } = audited('F01');
  ok(T(work, 'run', 'begin')); tick(work, '--rule', 'reach-04'); ok(T(work, 'plan', 'lock')); ok(T(work, 'run', 'wave', 'begin', '3'));
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  const f7 = idOf(work, runId, 'reach-04', 'src/barrel/b.ts');
  exit(T(work, 'findings', 'skip', f8), 2, /usage/);
  ok(T(work, 'findings', 'skip', f8, '--reason', 'test/plugin-loader.test.ts:4 imports it by a computed path'));
  assert.equal(readF(work, runId, f8).front.state, 'skipped');
  assert.match(readF(work, runId, f8).body, /computed path/);
  exit(T(work, 'findings', 'skip', f8, '--reason', 'again'), 5, /only an approved/);
  edit(work, 'src/barrel/b.ts', (t) => t.replace('export function deadHelper', 'function deadHelper') + 'export const marker = 1;\n');
  edit(work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  ok(T(work, 'commit', f7, '-m', 'internalize deadHelper'));
  // a finding still approved blocks the end of its wave
  const w = ok(T(work, 'gate', '--wave', '3'));
  assert.equal(w.json.result.passed, true);
  ok(T(work, 'run', 'wave', 'end', '3'));
  ok(T(work, 'validate'));
});

test('3.2 seeded breaker: the wave gate goes red on a test typecheck cannot see; bisect names the commit, revert restores it, the gate is green', () => {
  seedBreaker('F01');
  const work = auditFixture('F01', { reset: false });
  const runId = latestRun(work);
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  startWave(work, runId, 'reach-04', '3');
  const f7 = idOf(work, runId, 'reach-04', 'src/barrel/b.ts');
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  edit(work, 'src/barrel/b.ts', (t) => t.replace('export function deadHelper', 'function deadHelper') + 'export const marker = 1;\n');
  edit(work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  ok(T(work, 'commit', f7, '-m', 'internalize deadHelper'));
  edit(work, 'src/internal.ts', (t) => t.replace('export function normalize', 'function normalize'));
  const c8 = ok(T(work, 'commit', f8, '-m', 'internalize normalize'), 'the fast check cannot see the dynamic consumer');
  const red = T(work, 'gate', '--wave', '3');
  assert.equal(red.status, 6, red.text.slice(0, 800));
  assert.equal(red.json.result.passed, false);
  assert.equal(red.json.result.legs.typecheck.status, 'pass');
  assert.equal(red.json.result.legs.test.status, 'fail');
  assert.match(red.json.result.legs.test.tail, /keeps its public surface|toHaveLength|expected/i);
  exit(T(work, 'run', 'wave', 'end', '3'), 5, /gate/);
  const bi = ok(T(work, 'bisect', '--wave', '3'), 'bisect');
  assert.equal(bi.json.result.culprit, f8);
  assert.equal(bi.json.result.commit.slice(0, 7), c8.json.result.sha);
  assert.ok(bi.json.result.output_ref, 'the red probe output is kept');
  const rv = ok(T(work, 'revert', f8, '--reason', 'dynamic consumer: test/plugin-loader.test.ts'), 'revert');
  assert.equal(readF(work, runId, f8).front.state, 'reverted');
  assert.match(gout(work, 'log', '-1', '--format=%B'), /Reverts-Finding: F-\d+/);
  assert.ok(rv.json.result);
  const green = ok(T(work, 'gate', '--wave', '3'), 'gate green after the revert');
  assert.equal(green.json.result.passed, true);
  ok(T(work, 'run', 'wave', 'end', '3'));
  ok(T(work, 'validate'));
  assert.match(readFileSync(join(work, 'src', 'internal.ts'), 'utf8'), /export function normalize/);
});

test('3.18 crash recovery: a scan killed after its first engine resumes without re-running it; an unjudged candidate is listed by verdict status', async () => {
  const work = ensureFixture('F01', { reset: true });
  const child = spawn(process.execPath, [BIN, 'scan', '--cwd', work, '--mode', 'standard', '--abandon-open'], { cwd: work, env, stdio: 'ignore' });
  const runsDir = join(work, '.ts-optimize', 'runs');
  const doneDir = () => { try { const [r] = readdirSync(runsDir); return r ? join(runsDir, r, 'raw', '.done') : null; } catch { return null; } };
  const t0 = Date.now();
  let markers = [];
  while (Date.now() - t0 < 60_000) {
    const d = doneDir();
    if (d && existsSync(d)) { markers = readdirSync(d); if (markers.length && markers.length < 5) break; }
    await new Promise((r) => setTimeout(r, 15));
  }
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));
  assert.ok(markers.length >= 1, 'at least one engine finished before the kill');
  const runId = readdirSync(runsDir)[0];
  assert.equal(JSON.parse(readFileSync(join(runsDir, runId, 'run.json'), 'utf8')).state, 'scanning', 'the killed run is still scanning');
  const out = spawnSync(process.execPath, [BIN, 'scan', '--cwd', work, '--resume', runId], { cwd: work, encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  for (const m of markers) assert.match(out.stderr + out.stdout, new RegExp(`\\[scan\\] ${m}: reusing finished output`));
  assert.ok(existsSync(join(runsDir, runId, 'raw', 'candidates.jsonl')), 'the resumed scan wrote the candidate list');
  assert.ok(readdirSync(join(runsDir, runId, 'raw', '.done')).length > markers.length, 'the remaining engines finished');
  // triage interrupted: nothing judged yet -> verdict status names every candidate that needs a verdict
  const vs = ok(T(work, 'verdict', 'status'), 'verdict status');
  assert.ok(vs.json.result.pending > 0 && vs.json.result.pending_ids.length === vs.json.result.pending, vs.text.slice(0, 400));
});

test('3.9 resume: after a session dies mid-wave, H1 points at the open run and run status continues at the first unfinished finding', () => {
  const { work, runId } = audited('F01');
  startWave(work, runId, 'reach-04', '3');
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  edit(work, 'src/internal.ts', (t) => t.replace('export function normalize', 'function normalize'));
  ok(T(work, 'commit', f8, '-m', 'internalize normalize'));
  // half an edit for the next finding is on disk when the session dies
  edit(work, 'src/barrel/b.ts', (t) => t.replace('export function deadHelper', 'function deadHelper'));
  // new session: SessionStart hook exactly as hooks.json runs it
  const hook = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0].command.split('${CLAUDE_PLUGIN_ROOT}').join(REPO);
  const h = spawnSync('bash', ['-c', hook], { cwd: work, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume', cwd: work }), encoding: 'utf8', env: { ...env, CLAUDE_PLUGIN_ROOT: REPO } });
  assert.equal(h.status, 0);
  const ctx = JSON.parse(h.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, new RegExp(`run ${runId} is APPLYING on branch chore/ts-cleanup \\(wave 3\\)`));
  assert.match(ctx, /Continue with \/ts-optimize:fix; commits go through `ts-opt commit` only/);
  const st = ok(T(work, 'run', 'status')).json.result;
  assert.equal(st.state, 'applying');
  assert.equal(st.wave, '3');
  assert.ok(st.uncommitted_files >= 1, 'the half-made edit is visible');
  const left = ok(T(work, 'findings', 'list', '--wave', '3', '--state', 'approved')).json.result.findings.map((f) => f.id);
  assert.ok(!left.includes(f8), 'the committed finding is not offered again');
  assert.equal(left.length, 1);
  // the check sees the half edit (b.ts is no longer a module while the barrel still re-exports it); finishing it makes the commit possible
  exit(T(work, 'check'), 6, /TS2306/);
  edit(work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  ok(T(work, 'commit', left[0], '-m', 'internalize deadHelper'));
});

test('review fixes: finish needs a green post-flight at the current worktree; a recovered (reverted) run finishes; abort never deletes a branch the user owned', () => {
  // (a) revert recovery reaches the end: P accounts for the Reverts-Finding commit, finish records the final gate
  seedBreaker('F01');
  const work = auditFixture('F01', { reset: false });
  const runId = latestRun(work);
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  startWave(work, runId, 'reach-04', '3');
  const f7 = idOf(work, runId, 'reach-04', 'src/barrel/b.ts');
  const f8 = idOf(work, runId, 'reach-04', 'src/internal.ts');
  edit(work, 'src/barrel/b.ts', (t) => t.replace('export function deadHelper', 'function deadHelper') + 'export const marker = 1;\n');
  edit(work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  ok(T(work, 'commit', f7, '-m', 'internalize deadHelper'));
  edit(work, 'src/internal.ts', (t) => t.replace('export function normalize', 'function normalize'));
  ok(T(work, 'commit', f8, '-m', 'internalize normalize'));
  exit(T(work, 'gate', '--wave', '3'), 6);
  ok(T(work, 'revert', f8, '--reason', 'dynamic consumer'));
  ok(T(work, 'gate', '--wave', '3')); ok(T(work, 'run', 'wave', 'end', '3'));
  exit(T(work, 'run', 'finish'), 5, /needs a green post-flight/);
  // the cascade of f7 (b.ts orphaned) must be accounted for before P can be green: skip it, like a user declining the cascade
  const rs = ok(T(work, 'rescan', '--wave', '3'));
  for (const c of rs.json.result.new_cascades) ok(T(work, 'findings', 'skip', c, '--reason', 'declined'));
  const p = T(work, 'gate', '--wave', 'P');
  assert.equal(p.status, 0, p.text.slice(0, 1500));
  assert.equal(p.json.result.legs['diff-accounting'].status, 'pass', 'the revert commit is accounted for');
  // code changes after the green post-flight: finish refuses
  edit(work, 'src/flags.ts', (t) => t + '\n// touched after the gate\n');
  exit(T(work, 'run', 'finish'), 5, /different worktree/);
  git(work, 'checkout', '--', 'src/flags.ts');
  ok(T(work, 'run', 'finish'), 'finish at the verified state');
  assert.match(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'SUMMARY.md'), 'utf8'), /final gate \(P\): passed — typecheck pass/);

  // (b) abort leaves a branch the run did not create
  const w2 = audited('F01');
  git(w2.work, 'checkout', '-q', '-b', 'feature/mine');
  writeFileSync(join(w2.work, 'NOTES.txt'), 'mine\n'); commitDirty(w2.work, 'my own work');
  ok(T(w2.work, 'run', 'begin'));
  assert.equal(gout(w2.work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/mine');
  const ab = ok(T(w2.work, 'run', 'abort'));
  assert.equal(gout(w2.work, 'branch', '--list', 'feature/mine').trim().replace('* ', ''), 'feature/mine', 'the user branch still exists');
  assert.match(ab.text, /was yours before this run/);
});
