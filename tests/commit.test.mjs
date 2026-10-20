// Phase 3 acceptance rows 3.1 (trailers), 3.2 (bisect + revert), 3.7, 3.12, 3.13, 3.21 for `ts-opt commit | revert | bisect`.
// Unit tests inject runCheck/runGate stubs (the gate engine is another module); the last test uses the real engine when it exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO } from './harness/fixture.mjs';
import { allFindings, beginApplying, git, logEvents, readF, runJson, writeRunJson } from './harness/applying.mjs';
import { run as commitRun } from '../lib/cli/commit.mjs';
import { run as revertRun } from '../lib/cli/revert.mjs';
import { run as bisectRun } from '../lib/cli/bisect.mjs';
import { checkCommitPolicy, parseDiff } from '../lib/gate/commit-policy.mjs';
import { worktreeFingerprint } from '../lib/gate/fingerprint.mjs';

process.env.TSOPT_NS = 'commit';
process.env.TS_OPT_HOME = join(DEV, 'home');

const out = (work, ...a) => git(work, ...a).stdout.trim();
const edit = (work, rel, fn) => { const p = join(work, rel); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
const stubCheck = (over = {}) => async ({ root }) => ({ engine: 'native', ms: 12, new_errors: [], baseline_errors: 0, fingerprint: await worktreeFingerprint(root), passed: true, ...over });
const commit = (s, ids, opts = {}, flags = {}) => commitRun({ cwd: s.work, flags, args: ids }, { runCheck: stubCheck(), ...opts });
const validateOk = (work) => { const r = spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), 'validate', '--cwd', work], { cwd: work, encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: join(DEV, 'home') } }); assert.equal(r.status, 0, r.stdout + r.stderr); };
const code = (n) => (e) => e && e.code === n;
const staged = (work) => out(work, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
const unexport = (name) => (t) => t.replace(`export function ${name}`, `function ${name}`);

test('3.1 a commit carries Rule/Finding/Run/Wave/Fast-check trailers and writes the finding Applied section', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  const [id] = s.ids;
  const calls = [];
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  const r = await commit(s, [id], { runCheck: async (a) => { calls.push(a); return stubCheck()(a); } });
  assert.equal(r.exit ?? 0, 0, r.text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, s.runId);
  assert.deepEqual(calls[0].paths, ['src/internal.ts']);
  const msg = git(s.work, 'log', '-1', '--format=%B').stdout.trimEnd() + '\n';
  assert.match(msg, /^refactor\(ts-optimize\): .*reach-04.* in src\/internal\.ts:1\n\nRule: reach-04\nFinding: F-\d{4}\nRun: \S+\nWave: 3\nFast-check: pass \(native, 12ms\)\n$/);
  assert.ok(msg.includes(`Finding: ${id}`) && msg.includes(`Run: ${s.runId}`));
  assert.equal(out(s.work, 'show', '--name-only', '--format=', 'HEAD'), 'src/internal.ts');
  assert.deepEqual(r.result.ids, [id]);
  assert.deepEqual(r.result.files, ['src/internal.ts']);
  assert.equal(r.result.sha, out(s.work, 'rev-parse', '--short', 'HEAD'));
  assert.deepEqual(r.result.trailers, { Rule: ['reach-04'], Finding: [id], Run: s.runId, Wave: '3', 'Fast-check': 'pass (native, 12ms)' });
  const f = readF(s.work, s.runId, id);
  assert.equal(f.front.state, 'applied');
  assert.equal(f.front.applied.commit, r.result.sha);
  assert.equal(f.front.applied.gate, undefined);
  assert.match(f.sections.Applied, new RegExp(`commit: \`${r.result.sha}\``));
  assert.match(f.sections.Applied, /files: `src\/internal\.ts`/);
  assert.match(f.sections.Applied, /fast-check: pass \(native, 12ms\)/);
  assert.match(f.sections.Rollback, new RegExp(`git revert ${r.result.sha}`));
  const ev = logEvents(s.work, s.runId).find((e) => e.ev === 'commit');
  assert.deepEqual({ ids: ev.ids, sha: ev.sha, files: ev.files, wave: ev.wave }, { ids: [id], sha: r.result.sha, files: ['src/internal.ts'], wave: '3' });
  assert.match(ev.fingerprint, /^wt:/);
  assert.equal(runJson(s.work, s.runId).applying.finding, null);
  assert.equal(out(s.work, 'status', '--porcelain', '--', '.', ':!.ts-optimize'), '');
});

test('-m sets the summary; the type follows the rule (chore for reach-07, style for wave R0)', async () => {
  const s = beginApplying(null, { approve: ['slop-03@src/flags.ts'] });
  edit(s.work, 'src/flags.ts', (t) => t + '\n// tidy\n');
  const r = await commitRun({ cwd: s.work, flags: {}, args: [s.ids[0], '-m', 'drop  boolean   theater'] }, { runCheck: stubCheck() });
  assert.equal(r.exit ?? 0, 0, r.text);
  assert.equal(git(s.work, 'log', '-1', '--format=%s').stdout.trim(), 'style(ts-optimize): drop boolean theater');
  const t = beginApplying(null, { approve: ['reach-07@package.json'], wave: '5' });
  edit(t.work, 'package.json', (x) => x.replace(/\s*"is-odd": "3.0.1"\n/, '\n'));
  edit(t.work, 'package-lock.json', (x) => x + ' ');
  const r2 = await commit(t, t.ids);
  assert.equal(r2.exit ?? 0, 0, r2.text);
  assert.match(git(t.work, 'log', '-1', '--format=%s').stdout, /^chore\(ts-optimize\): /);
  assert.deepEqual(r2.result.files.sort(), ['package-lock.json', 'package.json']);
});

test('3.7 a raw edit outside touches is refused with exit 7, listed, and nothing is staged or committed', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  edit(s.work, 'src/errors.ts', (t) => t + '\n// stray\n');
  writeFileSync(join(s.work, 'src/new-file.ts'), 'export const x = 1;\n');
  const head = out(s.work, 'rev-parse', 'HEAD');
  const r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  const scope = r.result.violations.find((v) => v.rule === 'scope');
  assert.deepEqual(scope.paths.sort(), ['src/errors.ts', 'src/new-file.ts']);
  assert.match(r.text, /src\/errors\.ts/);
  assert.equal(out(s.work, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(staged(s.work), []);
  assert.equal(readF(s.work, s.runId, s.ids[0]).front.state, 'approved');
  assert.equal(logEvents(s.work, s.runId).filter((e) => e.ev === 'commit').length, 0);
});

test('3.7 consumers listed in touches at ingest are accepted', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/barrel/b.ts'] });
  const f = readF(s.work, s.runId, s.ids[0]);
  assert.ok(f.front.touches.includes('src/barrel/index.ts'), `touches ${f.front.touches}`);
  edit(s.work, 'src/barrel/b.ts', unexport('deadHelper'));
  edit(s.work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  const r = await commit(s, s.ids);
  assert.equal(r.exit ?? 0, 0, r.text);
  assert.deepEqual(r.result.files.sort(), ['src/barrel/b.ts', 'src/barrel/index.ts']);
});

test('a finding of a later wave, or of an earlier wave without a green gate, is refused', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts', 'reach-05@src/types.ts'], wave: '3' });
  const later = s.ids[1];
  assert.equal(readF(s.work, s.runId, later).front.wave, '4');
  edit(s.work, 'src/types.ts', (t) => t + '\n// later\n');
  let r = await commit(s, [later]);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations.map((v) => v.detail).join('\n'), new RegExp(`${later}: belongs to wave 4, the current wave is 3`));
  assert.equal(out(s.work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'chore/ts-cleanup');

  const t = beginApplying(null, { approve: ['reach-01@src/orphan.ts', 'reach-04@src/internal.ts'], wave: '3', earlierGreen: false });
  edit(t.work, 'src/internal.ts', unexport('normalize'));
  r = await commit(t, [t.ids[1]]);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations.map((v) => v.detail).join('\n'), /earlier wave 1 has no green gate/);
  // the same commit passes once wave 1 is green
  const run = runJson(t.work, t.runId);
  run.waves.find((w) => w.id === '1').gate = { passed: true };
  writeRunJson(t.work, t.runId, run);
  r = await commit(t, [t.ids[1]]);
  assert.equal(r.exit ?? 0, 0, r.text);
});

test('an unapproved finding, a non-applying run and a wrong branch are refused', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  const other = allFindings(s.work, s.runId).find((f) => f.front.state === 'open' && f.front.wave === '3').front.id;
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  let r = await commit(s, [other]);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /state is open, needs approved/);
  const run = runJson(s.work, s.runId);
  run.state = 'locked';
  writeRunJson(s.work, s.runId, run);
  r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /is locked; commits need an applying run/);
  run.state = 'applying';
  writeRunJson(s.work, s.runId, run);
  git(s.work, 'checkout', '-q', '-b', 'somewhere-else');
  await assert.rejects(() => commit(s, s.ids), code(5));
  await assert.rejects(() => commit(s, []), code(2));
});

test('3.13 F06: deleting worker-configuration.d.ts, dropping ctx.waitUntil( and adding process.env (variant without it) are refused', async () => {
  const idx = 'variants/b-toml/src/index.ts';
  const s = beginApplying(null, { fixture: 'F06', approve: [{ select: `plat-02@${idx}`, patch: { wave: '3', fix_mode: 'auto', touches: [idx, 'variants/b-toml/worker-configuration.d.ts'] } }] });
  const reset = () => { git(s.work, 'checkout', '-q', '--', '.'); };
  const details = (r) => r.result.violations.map((v) => `${v.rule}: ${v.detail}`).join('\n');

  rmSync(join(s.work, 'variants/b-toml/worker-configuration.d.ts'));
  let r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.deepEqual(r.result.violations.map((v) => v.rule), ['protected-path']);
  assert.deepEqual(r.result.violations[0].paths, ['variants/b-toml/worker-configuration.d.ts']);
  reset();

  edit(s.work, idx, (t) => t.replace('    ctx.waitUntil(logHit(url.pathname));\n', ''));
  r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.match(details(r), /edit-pattern: variants\/b-toml\/src\/index\.ts: ctx\.waitUntil\( occurrences decrease by 1/);
  reset();

  edit(s.work, idx, (t) => t.replace('return new Response("ok");', 'return new Response(process.env.EXTRA ?? "ok");'));
  r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.match(details(r), /edit-pattern: variants\/b-toml\/src\/index\.ts: adds process\.env .*process_env_populated=false/);
  assert.equal(out(s.work, 'rev-parse', 'HEAD'), s.base);
  assert.deepEqual(staged(s.work), []);
  reset();

  // replacing one waitUntil call by another keeps the count: allowed
  edit(s.work, idx, (t) => t.replace('ctx.waitUntil(instance.status());', 'ctx.waitUntil(instance.status().then(() => undefined));'));
  r = await commit(s, s.ids);
  assert.equal(r.exit ?? 0, 0, r.text);
});

test('edit patterns are per worker variant: process.env is fine where the runtime populates it; handler and cloudflare imports are protected', () => {
  const mk = (file, removed, added) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,${removed.length} +1,${added.length} @@\n${removed.map((l) => '-' + l).join('\n')}${removed.length ? '\n' : ''}${added.map((l) => '+' + l).join('\n')}\n`;
  const front = { id: 'F-0001', rule: 'plat-02', wave: '3', state: 'approved', verdict: 'confirmed', confidence: 'likely', fix_mode: 'auto', fix_risk: 'low', touches: ['variants/a-jsonc/src/index.ts', 'variants/a-jsonc/src/other.ts', 'variants/b-toml/src/index.ts', 'src/not-a-worker.ts'] };
  const variants = [
    { dir: 'variants/a-jsonc', process_env_populated: true, entry_files: ['variants/a-jsonc/src/index.ts'] },
    { dir: 'variants/b-toml', process_env_populated: 'unknown', entry_files: ['variants/b-toml/src/index.ts'] },
  ];
  const base = { root: '/x', run: { id: 'r', state: 'applying', applying: { wave: '3' }, waves: [] }, findings: [{ id: 'F-0001', front }], config: {}, detect: { packs: [{ name: 'workerd', variants }], pm: { name: 'npm' } }, protectedGlobs: [] };
  const ok = (file, removed, added) => checkCommitPolicy({ ...base, changed: [{ status: ' M', path: file }], diffText: mk(file, removed, added) });
  assert.equal(ok('variants/a-jsonc/src/index.ts', [], ['const a = process.env.X;']).ok, true);
  const unknown = ok('variants/b-toml/src/index.ts', [], ['const a = process.env.X;']);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.violations[0].rule, 'edit-pattern');
  assert.equal(ok('variants/b-toml/src/index.ts', ['const a = process.env.X;'], ['const a = process.env.Y;']).ok, true);
  assert.equal(ok('variants/a-jsonc/src/index.ts', ['export default {'], ['const handler = {']).ok, false);
  assert.equal(ok('variants/a-jsonc/src/index.ts', ['  async fetch(request: Request) {'], ['  async fetchAll(request: Request) {']).ok, false);
  assert.equal(ok('variants/a-jsonc/src/index.ts', ['import { DurableObject } from "cloudflare:workers";'], []).ok, false);
  assert.equal(ok('variants/a-jsonc/src/other.ts', ['ctx.waitUntil(a());', 'ctx.waitUntil(b());'], ['ctx.waitUntil(Promise.all([a(), b()]));']).ok, false);
  assert.equal(ok('src/not-a-worker.ts', ['ctx.waitUntil(a());'], []).ok, true);
});

test('5.2 preview: semantic-invariance rules refuse changed test assertions, new control flow, and > 5 files', async () => {
  const s = beginApplying(null, { approve: ['reach-03@src/testonly.ts'] });
  const [id] = s.ids;
  const f = readF(s.work, s.runId, id);
  assert.deepEqual(f.front.touches.sort(), ['src/testonly.ts', 'test/testonly.test.ts']);
  edit(s.work, 'test/testonly.test.ts', (t) => t.replace('.toBe("7:user-7")', '.toBe("7:user-8")'));
  let r = await commit(s, [id]);
  assert.equal(r.exit, 7);
  assert.equal(r.result.violations[0].rule, 'semantic-invariance');
  assert.match(r.result.violations[0].detail, /test assertion lines changed/);
  assert.deepEqual(r.result.violations[0].paths, ['test/testonly.test.ts']);
  git(s.work, 'checkout', '-q', '--', '.');

  edit(s.work, 'src/testonly.ts', (t) => t.replace('return { id, name: `user-${id}` };', 'if (id < 0) return { id: 0, name: "none" };\n  return { id, name: `user-${id}` };'));
  r = await commit(s, [id]);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /added control flow .*if \(id < 0\)/);

  // an import-path edit in the test and a pure move of existing lines are fine
  git(s.work, 'checkout', '-q', '--', '.');
  edit(s.work, 'test/testonly.test.ts', (t) => t.replace('"../src/testonly.ts"', '"../src/testonly.js"'));
  r = await commit(s, [id]);
  assert.equal(r.exit ?? 0, 0, r.text);

  // policy level: the opt-in field and the file cap
  const front = { ...f.front, state: 'approved', touches: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] };
  const diff = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `diff --git a/${n}.ts b/${n}.ts\n--- a/${n}.ts\n+++ b/${n}.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = a && b;\n`).join('');
  const base = { root: '/x', run: runJson(s.work, s.runId), findings: [{ id, front }], changed: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ status: ' M', path: `${n}.ts` })), config: {}, detect: {}, diffText: diff };
  let p = checkCommitPolicy(base);
  assert.ok(p.violations.some((v) => /6 files changed; a refactor unit is at most 5/.test(v.detail)));
  assert.ok(p.violations.some((v) => /added control flow/.test(v.detail)));
  p = checkCommitPolicy({ ...base, findings: [{ id, front: { ...front, allows_new_control_flow: true } }] });
  assert.ok(!p.violations.some((v) => /added control flow/.test(v.detail)));
});

test('fix_risk high needs all three triage answers and evidence', () => {
  const front = { id: 'F-0001', rule: 'reach-01', wave: '1', state: 'approved', verdict: 'confirmed', confidence: 'likely', fix_mode: 'assisted', fix_risk: 'high', touches: ['src/a.ts'], triage: { framework_lifecycle: 'no', dynamic_invocation: 'no', public_contract: null, evidence: [] } };
  const base = { root: '/x', run: { id: 'r', state: 'applying', applying: { wave: '1' }, waves: [] }, findings: [{ id: 'F-0001', front }], changed: [{ status: ' D', path: 'src/a.ts' }], config: {}, detect: {} };
  let p = checkCommitPolicy(base);
  assert.equal(p.violations[0].rule, 'risk-evidence');
  assert.match(p.violations[0].detail, /missing public_contract.*no evidence recorded|\(none recorded\)/);
  p = checkCommitPolicy({ ...base, findings: [{ id: 'F-0001', front: { ...front, triage: { ...front.triage, public_contract: 'no', evidence: ['rg -w a → 0 hits'] } } }] });
  assert.equal(p.ok, true);
});

test('fast check: a stale or failing result is refused, a stored result at the current fingerprint is reused', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  let r = await commit(s, s.ids, { runCheck: stubCheck({ new_errors: [{ file: 'src/wrapper.ts', line: 1, code: 'TS2305', message: 'x' }], passed: false }) });
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /1 new diagnostic\(s\): src\/wrapper\.ts\(1\) TS2305/);
  r = await commit(s, s.ids, { runCheck: stubCheck({ fingerprint: 'wt:old' }) });
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /different worktree state/);
  // stored fast-check.json at the current fingerprint: the check does not run again
  const fingerprint = await worktreeFingerprint(s.work);
  writeFileSync(join(s.work, '.ts-optimize', 'state', 'fast-check.json'), JSON.stringify({ fingerprint, at: new Date().toISOString(), engine: 'tsgo', ms: 700, new_errors: [] }));
  r = await commit(s, s.ids, { runCheck: async () => { throw new Error('must not run'); } });
  assert.equal(r.exit ?? 0, 0, r.text);
  assert.match(git(s.work, 'log', '-1', '--format=%B').stdout, /Fast-check: pass \(tsgo, 700ms\)/);
});

test('3.12 a failing repo pre-commit hook is surfaced (exit 6), never bypassed; staged files stay staged; nothing is recorded', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  const hook = join(s.work, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "HOOK-SAYS-NO: lint-staged failed" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  try {
    edit(s.work, 'src/internal.ts', unexport('normalize'));
    const head = out(s.work, 'rev-parse', 'HEAD');
    const r = await commit(s, s.ids);
    assert.equal(r.exit, 6);
    assert.match(r.result.output, /HOOK-SAYS-NO: lint-staged failed/);
    assert.match(r.text, /HOOK-SAYS-NO/);
    assert.equal(out(s.work, 'rev-parse', 'HEAD'), head);
    assert.deepEqual(staged(s.work), ['src/internal.ts']);
    assert.deepEqual(r.result.staged, ['src/internal.ts']);
    assert.equal(readF(s.work, s.runId, s.ids[0]).front.state, 'approved');
    assert.equal(readF(s.work, s.runId, s.ids[0]).front.applied, null);
    assert.equal(logEvents(s.work, s.runId).filter((e) => e.ev === 'commit').length, 0);
    // config.commit.no_verify true is the only way past it
    writeFileSync(join(s.work, '.ts-optimize', 'config.json'), JSON.stringify({ schema: 'ts-optimize/config@1', commit: { no_verify: true } }));
    const r2 = await commit(s, s.ids);
    assert.equal(r2.exit ?? 0, 0, r2.text);
    assert.equal(readF(s.work, s.runId, s.ids[0]).front.state, 'applied');
  } finally { unlinkSync(hook); }
});

test('3.21 commit.granularity: finding refuses multi-finding commits; batched allows same-rule low-risk ones; revert marks every member reverted', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts', 'reach-04@src/barrel/b.ts'], config: { schema: 'ts-optimize/config@1', commit: { granularity: 'finding' } } });
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  edit(s.work, 'src/barrel/b.ts', unexport('deadHelper'));
  edit(s.work, 'src/barrel/index.ts', (t) => t.replace('export { deadHelper } from "./b.ts";\n', ''));
  let r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /granularity is "finding"/);
  writeFileSync(join(s.work, '.ts-optimize', 'config.json'), JSON.stringify({ schema: 'ts-optimize/config@1', commit: { granularity: 'batched', batch_max: 1 } }));
  r = await commit(s, s.ids);
  assert.equal(r.exit, 7);
  assert.match(r.result.violations[0].detail, /exceed commit\.batch_max 1/);
  writeFileSync(join(s.work, '.ts-optimize', 'config.json'), JSON.stringify({ schema: 'ts-optimize/config@1', commit: { granularity: 'batched', batch_max: 25 } }));
  r = await commit(s, s.ids);
  assert.equal(r.exit ?? 0, 0, r.text);
  const msg = git(s.work, 'log', '-1', '--format=%B').stdout;
  for (const id of s.ids) assert.ok(msg.includes(`Finding: ${id}`));
  assert.equal((msg.match(/^Rule: /gm) || []).length, 1);
  assert.equal(out(s.work, 'rev-list', '--count', `${s.base}..HEAD`), '1');
  const commitSha = out(s.work, 'rev-parse', 'HEAD');

  const rv = await revertRun({ cwd: s.work, flags: { reason: 'wave 3 gate: build failed after this commit (bisect)' }, args: [s.ids[0]] });
  assert.equal(rv.exit ?? 0, 0, rv.text);
  assert.deepEqual(rv.result.reverted.sort(), [...s.ids].sort());
  for (const id of s.ids) {
    const f = readF(s.work, s.runId, id);
    assert.equal(f.front.state, 'reverted');
    assert.equal(f.front.reverted.commit, rv.result.sha);
    assert.equal(f.front.reverted.reason, 'wave 3 gate: build failed after this commit (bisect)');
    assert.equal(f.front.applied.commit, commitSha.slice(0, f.front.applied.commit.length));
    assert.match(f.sections.Applied, /reverted: `/);
  }
  const rmsg = git(s.work, 'log', '-1', '--format=%B').stdout;
  for (const id of s.ids) assert.ok(rmsg.includes(`Reverts-Finding: ${id}`), rmsg);
  assert.match(rmsg, /This reverts commit/);
  assert.doesNotMatch(rmsg, /^Finding:/m);
  assert.match(readFileSync(join(s.work, 'src/internal.ts'), 'utf8'), /export function normalize/);
  assert.equal(out(s.work, 'status', '--porcelain', '--', '.', ':!.ts-optimize'), '');
  const ev = logEvents(s.work, s.runId).find((e) => e.ev === 'revert');
  assert.deepEqual({ ids: ev.ids.sort(), sha: ev.sha }, { ids: [...s.ids].sort(), sha: rv.result.sha });
  await assert.rejects(() => revertRun({ cwd: s.work, flags: {}, args: [s.ids[0]] }), code(5));
  validateOk(s.work); // applied/reverted front matter stays schema-valid
});

test('revert: a conflict aborts cleanly (exit 6, repository unchanged); not valid outside applying|verifying; needs a clean tree', async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  let r = await commit(s, s.ids);
  assert.equal(r.exit ?? 0, 0, r.text);
  // somebody else edits the same lines afterwards
  edit(s.work, 'src/internal.ts', (t) => t.replace('function normalize(input: string): string {\n  return input.trim().toLowerCase();', 'function normalize(input: string): string {\n  return input.normalize().trim();'));
  git(s.work, 'commit', '-qam', 'user edit');
  const head = out(s.work, 'rev-parse', 'HEAD');
  r = await revertRun({ cwd: s.work, flags: {}, args: [s.ids[0]] });
  assert.equal(r.exit, 6);
  assert.equal(r.result.conflict, true);
  assert.equal(out(s.work, 'rev-parse', 'HEAD'), head);
  assert.equal(out(s.work, 'status', '--porcelain', '--', '.', ':!.ts-optimize'), '');
  assert.notEqual(git(s.work, 'rev-parse', '-q', '--verify', 'REVERT_HEAD').status, 0);
  assert.equal(readF(s.work, s.runId, s.ids[0]).front.state, 'applied');
  assert.equal(logEvents(s.work, s.runId).filter((e) => e.ev === 'revert').length, 0);

  writeFileSync(join(s.work, 'src/stray.ts'), 'export {};\n');
  await assert.rejects(() => revertRun({ cwd: s.work, flags: {}, args: [s.ids[0]] }), code(5));
  rmSync(join(s.work, 'src/stray.ts'));
  const run = runJson(s.work, s.runId);
  run.state = 'locked';
  writeRunJson(s.work, s.runId, run);
  await assert.rejects(() => revertRun({ cwd: s.work, flags: {}, args: [s.ids[0]] }), code(5));
  await assert.rejects(() => revertRun({ cwd: s.work, flags: {}, args: ['nope'] }), code(2));
});

// ------------------------------------------------------------------------------------------------ bisect
const FIVE = ['slop-01@src/errors.ts', 'reach-01@src/orphan.ts', 'slop-03@src/flags.ts', 'reach-04@src/internal.ts', 'reach-05@src/types.ts'];
const FILES = ['src/errors.ts', 'src/orphan.ts', 'src/flags.ts', 'src/internal.ts', 'src/types.ts'];

async function fiveCommits(breakAt = 2) {
  const s = beginApplying(null, { approve: FIVE.map((select) => ({ select, patch: { wave: '3', fix_risk: 'low' } })), wave: '3' });
  const shas = [];
  for (let i = 0; i < 5; i++) {
    edit(s.work, FILES[i], (t) => t + (i === breakAt ? '\n// BREAK\n' : `\n// edit ${i}\n`));
    const r = await commit(s, [s.ids[i]]);
    assert.equal(r.exit ?? 0, 0, r.text);
    shas.push(out(s.work, 'rev-parse', 'HEAD'));
  }
  return { s, shas };
}
const gateStub = (calls, { throwAt = null } = {}) => async ({ root, wave, quiet, record }) => {
  calls.push({ wave, quiet, record, head: out(root, 'rev-parse', 'HEAD'), detached: out(root, 'rev-parse', '--abbrev-ref', 'HEAD') === 'HEAD' });
  if (throwAt !== null && calls.length === throwAt) throw new Error('gate crashed');
  const broken = readFileSync(join(root, 'src/flags.ts'), 'utf8').includes('BREAK');
  return { wave, passed: !broken, legs: { build: { status: broken ? 'fail' : 'pass', ms: 1 } }, fingerprint: 'wt:x', ms: 1 };
};
const bisect = (s, runGate, flags = { wave: '3' }) => bisectRun({ cwd: s.work, flags, args: [] }, { runGate });
const restored = (s, tip) => {
  assert.equal(out(s.work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'chore/ts-cleanup');
  assert.equal(out(s.work, 'rev-parse', 'HEAD'), tip);
  assert.equal(out(s.work, 'status', '--porcelain', '--', '.', ':!.ts-optimize'), '');
};

test('3.2 bisect names the first red commit of a 5-commit wave (real checkout/restore), logs it, and restores the branch tip', async () => {
  const { s, shas } = await fiveCommits(2);
  const calls = [];
  const r = await bisect(s, gateStub(calls));
  assert.equal(r.exit ?? 0, 0, r.text);
  assert.equal(r.result.culprit, s.ids[2]);
  assert.equal(r.result.commit, shas[2]);
  assert.equal(r.result.probes, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.wave === '3' && c.quiet === true && c.record === false));
  assert.deepEqual(calls.map((c) => c.head), [shas[4], shas[2], shas[1]]);
  assert.equal(calls[0].detached, false);
  assert.ok(calls.slice(1).every((c) => c.detached));
  restored(s, shas[4]);
  assert.match(r.result.output_ref, /apply\/gate\/bisect-wave-3-/);
  assert.ok(existsSync(join(s.work, r.result.output_ref)));
  const ev = logEvents(s.work, s.runId).find((e) => e.ev === 'bisect');
  assert.deepEqual({ wave: ev.wave, culprit: ev.culprit }, { wave: '3', culprit: s.ids[2] });

  // the fallback source (no log events): Wave:/Finding: trailers in tag..HEAD give the same answer
  unlinkSync(join(s.work, '.ts-optimize', 'runs', s.runId, 'apply', 'log.jsonl'));
  const r2 = await bisect(s, gateStub([]));
  assert.equal(r2.result.culprit, s.ids[2]);
  restored(s, shas[4]);

  // bisect then revert: the culprit is reverted with the gate output reference, the gate is green again
  const rv = await revertRun({ cwd: s.work, flags: { reason: 'wave 3 gate red after this commit (bisect)' }, args: [r2.result.culprit] });
  assert.equal(rv.exit ?? 0, 0, rv.text);
  const f = readF(s.work, s.runId, s.ids[2]);
  assert.equal(f.front.state, 'reverted');
  assert.equal(readF(s.work, s.runId, s.ids[3]).front.state, 'applied');
  assert.equal((await gateStub([])({ root: s.work, wave: '3' })).passed, true);
});

test('3.2 bisect: a green tip means nothing to bisect (exit 0, one probe, no log event); culprit at either end', async () => {
  const { s, shas } = await fiveCommits(2);
  const calls = [];
  const green = await bisect(s, async (a) => { calls.push(a); return { wave: a.wave, passed: true, legs: {} }; });
  assert.equal(green.exit ?? 0, 0);
  assert.equal(green.result.green, true);
  assert.equal(green.result.probes, 1);
  assert.match(green.text, /nothing to bisect/);
  assert.equal(logEvents(s.work, s.runId).filter((e) => e.ev === 'bisect').length, 0);
  restored(s, shas[4]);

  // first commit red: every commit after it is red too
  const first = await bisect(s, async () => ({ passed: false, legs: {} }), { wave: '3' });
  assert.equal(first.result.culprit, s.ids[0]);
  restored(s, shas[4]);
  // only the tip commit red
  const tipOnly = await bisect(s, async ({ root }) => ({ passed: !readFileSync(join(root, 'src/types.ts'), 'utf8').includes('edit 4') }));
  assert.equal(tipOnly.result.culprit, s.ids[4]);
  restored(s, shas[4]);
});

test('3.2 bisect restores the branch tip even when the gate throws, and refuses a dirty tree (exit 5) or an unknown wave (exit 3)', async () => {
  const { s, shas } = await fiveCommits(2);
  const calls = [];
  await assert.rejects(() => bisect(s, gateStub(calls, { throwAt: 2 })), /gate crashed/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].detached, true, 'the throw happened on a detached probe');
  restored(s, shas[4]);

  edit(s.work, 'src/cli.ts', (t) => t + '\n// dirty\n');
  const before = [];
  await assert.rejects(() => bisect(s, gateStub(before)), code(5));
  assert.equal(before.length, 0, 'no gate probe on a dirty tree');
  assert.equal(out(s.work, 'rev-parse', 'HEAD'), shas[4]);
  git(s.work, 'checkout', '-q', '--', '.');
  await assert.rejects(() => bisect(s, gateStub([]), { wave: '9' }), code(3));
  await assert.rejects(() => bisect(s, gateStub([]), {}), code(2));
});

test('parseDiff reads removed lines that look like headers and tolerates no-newline markers', () => {
  const d = parseDiff('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n--- a comment\n-b\n+++ c\n+d\n\\ No newline at end of file\ndiff --git a/y.ts b/y.ts\ndeleted file mode 100644\n--- a/y.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n');
  assert.deepEqual(d.get('x.ts').removed, ['-- a comment', 'b']);
  assert.deepEqual(d.get('x.ts').added, ['++ c', 'd']);
  assert.equal(d.get('y.ts').deleted, true);
  assert.deepEqual(d.get('y.ts').removed, ['gone']);
});

// ------------------------------------------------------------------------------------------------ end to end with the real gate engine
const HAVE_ENGINE = existsSync(join(REPO, 'lib', 'gate', 'check.mjs')) && existsSync(join(REPO, 'lib', 'gate', 'gate.mjs'));
test('end to end on F01 with the real fast check: un-export normalize, ts-opt commit, trailers and Applied section', { skip: HAVE_ENGINE ? false : 'lib/gate/check.mjs and lib/gate/gate.mjs do not exist yet (the gate engine is written in parallel); re-run once they land' }, async () => {
  const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'] });
  const [id] = s.ids;
  edit(s.work, 'src/internal.ts', unexport('normalize'));
  const ts = spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), 'commit', id, '-m', 'internalize normalize', '--json', '--cwd', s.work], { cwd: s.work, encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: join(DEV, 'home') } });
  const env = JSON.parse(ts.stdout);
  assert.equal(ts.status, 0, ts.stdout + ts.stderr);
  assert.equal(env.ok, true);
  assert.deepEqual(env.result.ids, [id]);
  const msg = git(s.work, 'log', '-1', '--format=%B').stdout.trimEnd() + '\n';
  assert.match(msg, /^refactor\(ts-optimize\): internalize normalize\n\nRule: reach-04\n/);
  for (const t of [`Finding: ${id}`, `Run: ${s.runId}`, 'Wave: 3']) assert.ok(msg.includes(t), msg);
  assert.match(msg, /^Fast-check: pass \(\S+( \S+)?, \d+ms\)$/m);
  const f = readF(s.work, s.runId, id);
  assert.equal(f.front.state, 'applied');
  assert.match(f.sections.Applied, /fast-check: pass/);
  assert.match(f.sections.Applied, new RegExp('`' + env.result.sha + '`'));
  validateOk(s.work);
});
