// Phase 3 gate engine: baseline / gate / check (acceptance rows 3.1, 3.5, 3.15, 3.16, 4.4 support).
// Needs fixtures (tests/harness/fixture.mjs) and the dev toolbox incl. toolbox-native. Run: node --test tests/gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TSOPT_NS = 'gate'; // own fixture copies: test files run in parallel
process.env.TS_OPT_HOME ||= join(process.env.HOME, '.cache', 'ts-optimize-dev', 'home');
const { auditFixture, cli, readRunJson, writeRunJson, runPath } = await import('./harness/fixrun.mjs');
const { gitStatus, makeComposite, tscOf } = await import('./harness/gate-helpers.mjs');
const { runLeg } = await import('../lib/gate/exec.mjs');
const { multisetRecord } = await import('../lib/gate/baseline.mjs');
const { newFingerprints, diagMultiset } = await import('../lib/gate/fingerprint.mjs');

const sh = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const json = (args, work) => { const r = cli([...args, '--json', '--cwd', work], work); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr }; };
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const edit = (work, rel, fn) => writeFileSync(join(work, rel), fn(readFileSync(join(work, rel), 'utf8')));
const timings = [];
const note = (t, label, ms) => { timings.push(`${label}: ${ms} ms`); t.diagnostic(`${label}: ${ms} ms`); };

/** craft the state the real `run begin` / `wave begin` will leave: applying wave 3 */
function applying(work, wave = '3') {
  const r = readRunJson(work);
  r.state = 'applying';
  r.applying = { wave, pass: 1, finding: null, branch: 'main', base: r.repo.head };
  writeRunJson(work, r);
}
const setLeg = (work, id, patch) => { const r = readRunJson(work); const l = r.gate.legs.find((x) => x.id === id); Object.assign(l, patch); writeRunJson(work, r); return l; };
const marker = () => join(mkdtempSync(join(tmpdir(), 'tsopt-flaky-')), 'marker');

test('a) F01 green baseline + gate + check', async (t) => {
  const work = auditFixture('F01');
  applying(work);
  const b = json(['baseline'], work);
  assert.equal(b.status, 0, b.stderr);
  const res = b.out.result;
  assert.equal(res.status, 'green');
  const byId = Object.fromEntries(res.legs.map((l) => [l.id, l]));
  assert.equal(byId.typecheck.status, 'pass'); assert.ok(byId.typecheck.ms > 0);
  assert.equal(byId.test.status, 'pass'); assert.ok(byId.test.ms > 0);
  assert.equal(byId.build.status, 'not-applicable'); assert.match(byId.build.reason, /no "build" script/);
  assert.equal(byId['declaration-emit'].status, 'not-applicable');
  note(t, 'F01 baseline total', res.timings.total_ms); note(t, 'F01 typecheck (tsc 5.9)', byId.typecheck.ms); note(t, 'F01 test', byId.test.ms); note(t, 'F01 fast baseline (native)', res.fast_check_baseline_ms);
  const diag = JSON.parse(readFileSync(runPath(work, 'raw', 'baseline-diagnostics.json'), 'utf8'));
  assert.equal(diag.authoritative.count, 0); assert.match(diag.authoritative.engine, /^tsc@5\./); assert.ok(diag.fast && /^native@7\./.test(diag.fast.engine), 'fast compiler has its own record');
  const run = readRunJson(work);
  assert.equal(run.gate.baseline_status, 'green'); assert.equal(run.gate.red_baseline, null);
  assert.equal(run.gate.baseline.legs.find((l) => l.id === 'typecheck').status, 'pass');
  assert.ok(run.fast_check.baseline_ms > 0);
  assert.ok(res.metrics.type_soundness && res.metrics.type_soundness.metric, 'type soundness metric captured');
  assert.ok(existsSync(join(work, '.ts-optimize', 'baseline.json')) === false, 'baseline.json only with --save');

  const c = json(['check'], work);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(c.out.result.passed, true); assert.deepEqual(c.out.result.new_errors, []);
  assert.match(c.out.result.engine.kind, /native/);
  const fc = JSON.parse(readFileSync(join(work, '.ts-optimize', 'state', 'fast-check.json'), 'utf8'));
  assert.equal(fc.fingerprint, c.out.result.fingerprint); assert.ok(fc.at);
  note(t, 'F01 check (fast)', c.out.result.ms);

  const g = json(['gate', '--wave', '3'], work);
  assert.equal(g.status, 0, g.stderr);
  assert.equal(g.out.result.passed, true);
  assert.equal(g.out.result.legs.typecheck.status, 'pass'); assert.equal(g.out.result.legs.test.status, 'pass');
  assert.equal(g.out.result.legs['declaration-emit'].status, 'not-applicable');
  assert.match(g.out.result.fingerprint, /^wt:/);
  note(t, 'F01 gate wave 3', g.out.result.ms);
  const ev = lines(runPath(work, 'apply', 'log.jsonl')).filter((e) => e.ev === 'gate').pop();
  assert.equal(ev.wave, '3'); assert.equal(ev.legs.typecheck, 'pass'); assert.deepEqual(ev.flaky, []);
  assert.equal(readRunJson(work).waves.find((w) => w.id === '3').gate.passed, true);
  assert.ok(existsSync(join(work, g.out.result.legs.typecheck.tail_file)), 'tail saved under apply/gate/');
  // --save writes the committed ratchet file in the doc 04 section 8 shape
  const s = json(['baseline', '--save'], work);
  assert.equal(s.status, 0, s.stderr);
  const bj = JSON.parse(readFileSync(join(work, '.ts-optimize', 'baseline.json'), 'utf8'));
  assert.equal(bj.schema, 'ts-optimize/baseline@1'); assert.equal(bj.roots['.'].typecheck.errors, 0); assert.ok(bj.tests && bj.tests.exit === 0);
});

test('b) seeded breaker: check names the new fingerprints (exit 6), gate wave 3 fails on typecheck, revert -> green', async (t) => {
  const work = auditFixture('F01');
  applying(work);
  assert.equal(json(['baseline'], work).status, 0);
  edit(work, 'src/util/index.ts', (s) => s.replace('export function sum', 'function sum'));
  const c = json(['check'], work);
  assert.equal(c.status, 6, 'check exits 6 on new errors');
  const ne = c.out.result.new_errors;
  assert.ok(ne.length >= 1 && ne.every((e) => /sum/.test(e.message) && /^TS\d+$/.test(e.code) && e.file && e.line > 0), JSON.stringify(ne));
  assert.equal(c.out.result.passed, false);
  note(t, 'F01 check with breaker', c.out.result.ms);
  const g = json(['gate', '--wave', '3'], work);
  assert.equal(g.status, 6);
  assert.equal(g.out.result.passed, false);
  assert.equal(g.out.result.legs.typecheck.status, 'fail');
  assert.ok(g.out.result.legs.typecheck.new_fingerprints.some((n) => /sum/.test(n.message)), 'the diagnostic is named');
  assert.ok(g.out.result.failed_legs.includes('typecheck'));
  assert.ok(g.out.next_actions.some((a) => /bisect --wave 3/.test(a.cmd)));
  assert.equal(readRunJson(work).waves.find((w) => w.id === '3').gate.passed, false);
  sh(work, 'checkout', '--', 'src/util/index.ts');
  const g2 = json(['gate', '--wave', '3'], work);
  assert.equal(g2.status, 0, JSON.stringify(g2.out.result.legs.typecheck));
  assert.equal(json(['check'], work).status, 0);
});

test('d) flaky leg passes with flaky:true; a consistently failing leg fails (exit 6)', async () => {
  const work = auditFixture('F01');
  applying(work);
  assert.equal(json(['baseline'], work).status, 0);
  const m = marker();
  setLeg(work, 'test', { cmd: ['node', '-e', `const fs=require('fs');const f=${JSON.stringify(m)};if(!fs.existsSync(f)){fs.writeFileSync(f,'1');console.log('first run fails');process.exit(1)}console.log('Tests  1 passed (1)')`] });
  const g = json(['gate', '--wave', '3', '--legs', 'test'], work);
  assert.equal(g.status, 0, JSON.stringify(g.out.result.legs));
  assert.equal(g.out.result.passed, true);
  assert.equal(g.out.result.legs.test.status, 'pass'); assert.equal(g.out.result.legs.test.flaky, true);
  assert.deepEqual(lines(runPath(work, 'apply', 'log.jsonl')).filter((e) => e.ev === 'gate').pop().flaky, ['test']);
  setLeg(work, 'test', { cmd: ['node', '-e', "console.log('always red');process.exit(1)"] });
  const g2 = json(['gate', '--wave', '3', '--legs', 'test'], work);
  assert.equal(g2.status, 6);
  assert.equal(g2.out.result.legs.test.status, 'fail'); assert.equal(g2.out.result.legs.test.flaky, false);
  assert.match(g2.out.result.legs.test.tail, /always red/);
});

test('g) a timeout kills the whole process group', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tsopt-timeout-'));
  const pidFile = join(dir, 'pid');
  const script = `const c=require('child_process').spawn('sleep',['60'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
  const r = await runLeg({ id: 'test', cwd: '.', cmd: ['node', '-e', script], timeout_s: 60 }, { root: dir, timeoutMs: 1500 });
  assert.equal(r.status, 'fail'); assert.equal(r.timed_out, true);
  assert.ok(r.ms < 6000, `took ${r.ms} ms`);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'grandchild is gone');
  note(t, 'timeout leg (1500 ms limit)', r.ms);
  rmSync(dir, { recursive: true, force: true });
});

test('c) red baseline: exit 5 naming typecheck; --allow-red-baseline then one new error fails on that fingerprint only; h) fast and authoritative baselines are separate', async (t) => {
  const work = auditFixture('F01');
  applying(work);
  edit(work, 'src/util/index.ts', (s) => s + '\nexport const brokenOne: number = "x";\n');
  const red = json(['baseline'], work);
  assert.equal(red.status, 5);
  assert.match(red.out.error.message, /red baseline/); assert.match(red.out.error.message, /typecheck/);
  assert.equal(readRunJson(work).gate.baseline_status, 'red');
  const ok = json(['baseline', '--allow-red-baseline', 'typecheck'], work);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.out.result.status, 'red');
  const run = readRunJson(work);
  assert.deepEqual(run.gate.red_baseline.legs, ['typecheck']); assert.match(run.gate.red_baseline.diag_hash, /^sha1:/);
  assert.equal(run.gate.accepted_risk.by, 'user'); assert.match(run.gate.accepted_risk.statement, /typecheck/);
  // h) two records, two engines, one fingerprint each, and `check` matches the fast one
  const diagPath = runPath(work, 'raw', 'baseline-diagnostics.json');
  const diag = JSON.parse(readFileSync(diagPath, 'utf8'));
  assert.equal(diag.authoritative.count, 1); assert.equal(diag.fast.count, 1);
  assert.notEqual(diag.authoritative.engine, diag.fast.engine);
  // with the red baseline, nothing is new yet
  assert.equal(json(['gate', '--wave', '3', '--legs', 'typecheck'], work).status, 0);
  assert.equal(json(['check'], work).status, 0);
  // one new error: the old one is NOT reported
  edit(work, 'src/util/index.ts', (s) => s + 'export const brokenTwo: string = 2;\n');
  const g = json(['gate', '--wave', '3', '--legs', 'typecheck'], work);
  assert.equal(g.status, 6);
  const nf = g.out.result.legs.typecheck.new_fingerprints;
  assert.equal(nf.length, 1, JSON.stringify(nf)); assert.match(nf[0].message, /number|string/); assert.equal(nf[0].line, readFileSync(join(work, 'src/util/index.ts'), 'utf8').split('\n').findIndex((l) => l.includes('brokenTwo')) + 1);
  const c = json(['check'], work);
  assert.equal(c.status, 6); assert.equal(c.out.result.new_errors.length, 1); assert.equal(c.out.result.new_errors[0].line, nf[0].line);
  assert.equal(c.out.result.baseline_errors, 1);
  // h) `check` compares with the FAST record: empty it and the old error becomes new again, while the authoritative gate is unaffected
  diag.fast.multiset = {}; diag.fast.count = 0;
  writeFileSync(diagPath, JSON.stringify(diag));
  const c2 = json(['check'], work);
  assert.equal(c2.out.result.new_errors.length, 2);
  edit(work, 'src/util/index.ts', (s) => s.replace('export const brokenTwo: string = 2;\n', ''));
  assert.equal(json(['gate', '--wave', '3', '--legs', 'typecheck'], work).status, 0, 'authoritative baseline untouched');
  // untouched multiset logic: the same code with a different message is a different fingerprint
  const a = diagMultiset([{ severity: 'error', file: 'a.ts', code: 'TS2322', message: "Type 'string' is not assignable to type 'number'." }]);
  const b2 = diagMultiset([{ severity: 'error', file: 'a.ts', code: 'TS2322', message: "Type 'string' is not assignable to type 'number'" }, { severity: 'error', file: 'a.ts', code: 'TS2322', message: 'other wording' }]);
  assert.equal(newFingerprints(a, b2).length, 2);
  assert.equal(multisetRecord('x', { k: a }, ['k']).count, 1);
  note(t, 'red-baseline scenario ok', 0);
});

test('e) F13 (no tests): test leg unavailable, only waves B and 4 schedulable, risk acceptance cannot unlock it', async () => {
  const work = auditFixture('F13');
  applying(work, 'B');
  const b = json(['baseline'], work);
  assert.equal(b.status, 0, b.stderr);
  const test = b.out.result.legs.find((l) => l.id === 'test');
  assert.equal(test.status, 'unavailable'); assert.ok(test.reason);
  assert.deepEqual(b.out.result.schedulable_waves, ['B', '4']);
  assert.match(b.stderr + JSON.stringify(b.out), /B and 4|schedulable/);
  const b2 = json(['baseline', '--allow-red-baseline', 'test'], work);
  assert.equal(b2.status, 0); assert.deepEqual(b2.out.result.schedulable_waves, ['B', '4']);
  assert.ok(b2.out.warnings.some((w) => /missing test suite cannot be unlocked/.test(w)));
  const gB = json(['gate', '--wave', 'B'], work);
  assert.equal(gB.status, 0); // wave B needs only typecheck (test/build are recorded, not blocking)
  assert.equal(gB.out.result.legs.typecheck.status, 'pass');
  assert.equal(gB.out.result.legs.test.status, 'unavailable');
  assert.equal(gB.out.result.passed, true);
  const g1 = json(['gate', '--wave', '1'], work);
  assert.equal(g1.status, 6); assert.deepEqual(g1.out.result.failed_legs, ['test']);
});

test('f) -b --noEmit is probed: F02 composite solution -> emit-and-clean, git status clean; TS 5.4 TS5094 / 5.7 TS6310; pre-existing outputs survive', async (t) => {
  const work = auditFixture('F02');
  applying(work);
  const b = json(['baseline'], work);
  assert.equal(b.status, 0, b.stderr + JSON.stringify(b.out && b.out.error));
  const run = readRunJson(work);
  const tc = run.gate.legs.find((l) => l.id === 'typecheck');
  assert.equal(tc.variant, 'emit-and-clean'); assert.ok(tc.cmd.includes('--emitDeclarationOnly') && !tc.cmd.includes('--noEmit')); assert.deepEqual(tc.clean_cmd.slice(1), ['-b', 'tsconfig.json', '--clean']);
  const res = b.out.result;
  assert.equal(res.legs.find((l) => l.id === 'typecheck').status, 'pass');
  assert.equal(res.legs.find((l) => l.id === 'typecheck').variant, 'emit-and-clean');
  const decl = res.legs.filter((l) => l.id === 'declaration-emit');
  assert.ok(decl.length > 0 && decl.every((l) => l.status === 'pass'), JSON.stringify(decl));
  assert.ok(decl.some((l) => l.variant === 'emit-and-clean'), 'packages with references need -b');
  assert.equal(gitStatus(work).split('\n').filter((l) => l && !l.includes('.ts-optimize')).length, 0, 'git status clean afterwards');
  note(t, 'F02 baseline', res.timings.total_ms);
  const g = json(['gate', '--wave', '3'], work);
  assert.equal(g.status, 0, JSON.stringify(g.out.result.legs));
  assert.equal(g.out.result.legs.typecheck.variant, 'emit-and-clean');
  // per TS version, on a small composite project (solution -> a <- b, plus a reference-less composite)
  for (const [version, expectCode] of [['5.4', 'TS5094'], ['5.7', 'TS6310']]) {
    const tsc = tscOf(version);
    if (!tsc) { t.diagnostic(`typescript@${version} could not be installed; skipped`); continue; }
    const dir = makeComposite();
    const noEmit = spawnSync(tsc, ['-b', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8' });
    assert.match(noEmit.stdout, new RegExp(expectCode), `${version}: -b --noEmit gives ${expectCode}`);
    const leg = { id: 'typecheck', cwd: '.', timeout_s: 120, cmd: [tsc, '-b', 'tsconfig.json', '--noEmit', '--pretty', 'false'], variant: 'noemit-b' };
    const r = await runLeg(leg, { root: dir });
    assert.equal(r.status, 'pass', r.tail); assert.equal(r.adopted.variant, 'emit-and-clean'); assert.ok(r.adopted.from.includes(expectCode));
    assert.equal(gitStatus(dir), '', 'git status clean afterwards');
    // outputs the user built before survive the leg
    spawnSync(tsc, ['-b', 'tsconfig.json'], { cwd: dir });
    assert.ok(existsSync(join(dir, 'a', 'dist', 'i.d.ts')));
    const r2 = await runLeg({ ...leg, variant: 'emit-and-clean', cmd: r.adopted.cmd, clean_cmd: r.adopted.clean_cmd }, { root: dir });
    assert.equal(r2.status, 'pass', r2.tail);
    assert.ok(existsSync(join(dir, 'a', 'dist', 'i.d.ts')), 'pre-existing build output preserved');
    // a genuine type error is still a failure with the diagnostic
    writeFileSync(join(dir, 'b', 'src', 'i.ts'), 'export const y: number = "s";\n');
    const r3 = await runLeg({ ...leg, variant: 'emit-and-clean', cmd: r.adopted.cmd, clean_cmd: r.adopted.clean_cmd }, { root: dir });
    assert.equal(r3.status, 'fail'); assert.ok(r3.diagnostics.some((d) => d.code === 'TS2322'));
    t.diagnostic(`typescript@${version}: \`-b --noEmit\` -> ${expectCode}; variant emit-and-clean; git status clean`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timings', (t) => { for (const l of timings) t.diagnostic(l); });
