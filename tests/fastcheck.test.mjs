// H4 fast-check (PostToolBatch) on a pnpm monorepo, driven the way Claude Code drives it: the hook command from hooks.json, golden stdin.
// Rows 4.4 (breaking un-export names the consumer error, repeat batch silent, no fast compiler silent) and 4.5 (divergence x3 disables it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { git } from './harness/applying.mjs';
import { auditFixture, latestRun } from './harness/fixrun.mjs';

process.env.TSOPT_NS = 'fastcheck';
const BIN = join(REPO, 'bin', 'ts-opt');
const HOME = join(DEV, 'home');
const env = { ...process.env, TS_OPT_HOME: HOME, CI: '1' };
const T = (work, ...a) => { const r = spawnSync(process.execPath, [BIN, ...a, '--json', '--cwd', work], { cwd: work, encoding: 'utf8', env }); let json = null; try { json = JSON.parse(r.stdout); } catch { /* text */ } return { status: r.status, json, text: r.stdout + r.stderr }; };
const hookCmd = () => JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.PostToolBatch[0].hooks[0].command.split('${CLAUDE_PLUGIN_ROOT}').join(REPO);
const fire = (work, extraEnv = {}, filePath = 'packages/utils/src/index.ts') => {
  const t0 = process.hrtime.bigint();
  const r = spawnSync('bash', ['-c', hookCmd()], { cwd: work, input: JSON.stringify({ hook_event_name: 'PostToolBatch', cwd: work, tool_calls: [{ tool_name: 'Edit', tool_input: { file_path: join(work, filePath) } }] }), encoding: 'utf8', env: { ...env, CLAUDE_PLUGIN_ROOT: REPO, ...extraEnv } });
  return { status: r.status, stdout: r.stdout, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyingF02() {
  const work = auditFixture('F02');
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  assert.equal(T(work, 'run', 'begin').status, 0);
  assert.equal(T(work, 'plan', 'check', '--rule', 'reach-04').status, 0);
  assert.equal(T(work, 'plan', 'lock').status, 0);
  assert.equal(T(work, 'run', 'wave', 'begin', '3').status, 0);
  return work;
}

test('4.4 H4 on F02: a breaking un-export gets one additionalContext naming the consumer error within 5 s; the same tree is silent; no fast compiler is silent', async (t) => {
  const work = await applyingF02();
  const idx = join(work, 'packages/utils/src/index.ts');
  // nothing changed yet: silent, and the first check records the clean tree
  const quiet = fire(work);
  assert.equal(quiet.status, 0); assert.equal(quiet.stdout, '');
  await wait(3200); // the throttle window
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('export { capitalize, slugify, truncate }', 'export { capitalize, truncate }'));
  const a = fire(work);
  assert.equal(a.status, 0);
  const out = JSON.parse(a.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolBatch');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /fast-check \(native 7\.\d+\.\d+, [\d.]+ s\): 1 NEW error vs baseline/);
  assert.match(ctx, /apps\/cli\/src\/index\.ts\(\d+\) TS2305: .*slugify/);
  assert.match(ctx, /`ts-opt commit` refuses until clean/);
  assert.ok(a.ms < 5000, `took ${a.ms} ms`);
  t.diagnostic(`hook ${Math.round(a.ms)} ms: ${ctx}`);
  // a second batch on the unchanged tree: silent (even after the throttle window)
  await wait(3200);
  const again = fire(work);
  assert.equal(again.stdout, '');
  // fix it, check again: clean -> silent
  git(work, 'checkout', '--', 'packages/utils/src/index.ts');
  await wait(3200);
  assert.equal(fire(work).stdout, '');
  // disabled: env switch and run-level switch
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('export { capitalize, slugify, truncate }', 'export { capitalize, truncate }'));
  await wait(3200);
  assert.equal(fire(work, { TS_OPTIMIZE_HOOKS: 'off' }).stdout, '', 'TS_OPTIMIZE_HOOKS=off');
  const runPath = join(work, '.ts-optimize', 'runs', latestRun(work), 'run.json');
  const run = JSON.parse(readFileSync(runPath, 'utf8')); run.fast_check.enabled = false; run.fast_check.disabled_reason = 'no fast compiler';
  writeFileSync(runPath, JSON.stringify(run, null, 2));
  assert.equal(fire(work).stdout, '', 'no fast compiler for the run');
  git(work, 'checkout', '--', 'packages/utils/src/index.ts');
});

test('4.4b H4 is silent outside an applying run and in a repo without a run', async () => {
  const w = ensureFixture('F01', { reset: true });
  assert.equal(fire(w, {}, 'src/index.ts').stdout, '');
  const aud = auditFixture('F01');
  assert.equal(fire(aud, {}, 'src/index.ts').stdout, '', 'a planned run is not applying');
});

test('4.5 divergence: where the fast compiler fails and the authority passes, the commit proceeds on the authority, and the third time fast-check switches itself off and SUMMARY says tsgo-divergence', async () => {
  const work = auditFixture('F12');
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  assert.equal(T(work, 'run', 'begin').status, 0);
  assert.equal(T(work, 'plan', 'check', '--rule', 'reach-04').status, 0);
  assert.equal(T(work, 'plan', 'lock').status, 0);
  assert.equal(T(work, 'run', 'wave', 'begin', '3').status, 0);
  const runId = latestRun(work);
  const runJson = () => JSON.parse(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'run.json'), 'utf8'));
  const log = () => readFileSync(join(work, '.ts-optimize', 'runs', runId, 'apply', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const fid = T(work, 'findings', 'list', '--rule', 'reach-04').json.result.findings[0].id;
  // a constructor-function idiom the native compiler flags (TS2683) and TypeScript 5.9 accepts
  const reg = join(work, 'src/registry.js');
  writeFileSync(reg, readFileSync(reg, 'utf8') + '\n/**\n * @constructor\n * @param {number} a\n */\nfunction Dummy(a) { this.a = a; }\nDummy.prototype.get = function () { return this.a; };\n');
  const c = T(work, 'commit', fid, '-m', 'touch registry');
  assert.equal(c.status, 0, c.text.slice(0, 1500));
  assert.equal(runJson().fast_check.divergences, 1);
  assert.ok(log().some((e) => e.ev === 'divergence' && e.fast === 'fail' && e.auth === 'pass'));
  assert.equal(runJson().fast_check.enabled, true);
  // the wave gate probes the same disagreement each time it runs
  assert.equal(T(work, 'gate', '--wave', '3').status, 0);
  assert.equal(runJson().fast_check.divergences, 2);
  const g3 = T(work, 'gate', '--wave', '3');
  assert.equal(g3.status, 0, g3.text.slice(0, 800));
  assert.equal(runJson().fast_check.divergences, 3);
  assert.equal(runJson().fast_check.enabled, false);
  assert.equal(runJson().fast_check.disabled_reason, 'tsgo-divergence');
  // fast-check is now silent even for a breaking edit
  writeFileSync(reg, readFileSync(reg, 'utf8') + '\nconst broken = ;\n');
  await wait(3200);
  assert.equal(fire(work, {}, 'src/registry.js').stdout, '');
  git(work, 'checkout', '--', 'src/registry.js');
  const { divergenceNote } = await import('../lib/gate/divergence.mjs');
  assert.match(divergenceNote(work, runId), /^tsgo-divergence: the fast compiler failed where the authoritative compiler passed 3 times/);
});
