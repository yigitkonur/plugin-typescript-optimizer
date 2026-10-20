// Phase 5 rows driven through the real CLI: churn scoping (5.5), architect proposals with badges and codebase-health.md (5.1),
// the R wave with the semantic-invariance checks (5.2, 5.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './harness/fixture.mjs';
import { allFindings, git, readF } from './harness/applying.mjs';
import { auditFixture, latestRun } from './harness/fixrun.mjs';

process.env.TSOPT_NS = 'deep';
const BIN = join(REPO, 'bin', 'ts-opt');
const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' };
const T = (work, ...a) => { const r = spawnSync(process.execPath, [BIN, ...a, '--json', '--cwd', work], { cwd: work, encoding: 'utf8', env, timeout: 600_000 }); let json = null; try { json = JSON.parse(r.stdout); } catch { /* text */ } return { status: r.status, json, text: r.stdout + r.stderr }; };
const ok = (r, what = '') => { assert.equal(r.status, 0, `${what}\n${r.text.slice(0, 2000)}`); return r; };
const edit = (w, rel, fn) => { const p = join(w, rel); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
const dated = (work, date, ...args) => spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });

const MERMAID = 'flowchart TD\\n  subgraph Before\\n    idx[index] --> wrap[wrapper] --> int[internal]\\n  end\\n  subgraph After\\n    idx2[index] --> int2[internal]\\n  end';

function coldHistory() {
  const work = ensureFixture('F01', { reset: true });
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  assert.equal(dated(work, '2024-01-01T10:00:00', 'commit', '--amend', '--no-edit', '--date=2024-01-01T10:00:00').status, 0);
  edit(work, 'src/internal.ts', (t) => t + '\n// touched recently\n');
  git(work, 'add', '-A'); assert.equal(git(work, 'commit', '-m', 'touch internal.ts').status, 0);
  return auditFixture('F01', { mode: 'deep', reset: false });
}

test('5.5 + 5.1: structure triage keeps only hot modules; architect proposals carry badges; codebase-health.md has the diagram; bad diagrams are refused', () => {
  const work = coldHistory();
  const runId = latestRun(work);
  const plan = ok(T(work, 'triage', 'plan', '--kind', 'structure'), 'structure plan').json.result;
  const hot = plan.groups.flatMap((g) => g.modules);
  assert.deepEqual(hot, ['src/internal.ts'], 'only the module touched inside the window is hot');
  assert.ok(plan.cold_excluded >= 10, `cold modules excluded: ${plan.cold_excluded}`);
  assert.match(plan.window, /since 6 months/);
  const chunk = JSON.parse(readFileSync(join(work, plan.chunks[0].path), 'utf8'));
  assert.equal(chunk.kind, 'structure'); assert.equal(chunk.modules[0].file, 'src/internal.ts');
  assert.ok(chunk.modules[0].importers.length >= 1 && chunk.modules[0].commits >= 1);
  assert.ok(existsSync(join(work, '.ts-optimize', 'runs', runId, 'raw', 'churn.json')));
  // a fixture where nothing is hot proposes nothing
  // proposals
  const strong = ok(T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', 'src/wrapper.ts', '--line', '3', '--recommendation', 'STRONG',
    '--deletion-test', 'delete lengthOf: the complexity vanishes, its one caller can call slugLength', '--seam-test', 'one adapter, no second implementation', '--touch', 'src/wrapper.ts', '--touch', 'src/index.ts',
    '--plan-step', 'inline lengthOf at its caller', '--plan-step', 'delete src/wrapper.ts', '--mermaid', MERMAID), 'strong proposal');
  assert.equal(strong.json.result.schedulable, true);
  const spec = ok(T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-11', '--file', 'src/internal.ts', '--line', '1', '--recommendation', 'SPECULATIVE',
    '--deletion-test', 'would move normalize behind a port', '--seam-test', 'needs a second adapter first', '--touch', 'src/internal.ts'), 'speculative proposal');
  assert.equal(spec.json.result.schedulable, false);
  const sf = readF(work, runId, strong.json.result.id);
  assert.equal(sf.front.origin, 'architect'); assert.equal(sf.front.wave, 'R'); assert.equal(sf.front.recommendation, 'STRONG'); assert.equal(sf.front.state, 'open');
  assert.match(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'plan.md'), 'utf8'), new RegExp(`## Wave R[\\s\\S]*- \\[ \\] ${strong.json.result.id} struct-03`));
  const health = readFileSync(join(work, '.ts-optimize', 'runs', runId, 'codebase-health.md'), 'utf8');
  assert.match(health, /\[STRONG\] struct-03/); assert.match(health, /\[SPECULATIVE\] struct-11/);
  assert.match(health, /Deletion Test: delete lengthOf/); assert.match(health, /```mermaid\nflowchart TD\n  subgraph Before[\s\S]*subgraph After[\s\S]*```/);
  assert.match(health, /Schedule: wave R/); assert.match(health, /Schedule: not scheduled/);
  assert.equal(ok(T(work, 'validate')).status, 0);
  // the real Mermaid parser (dev cache only; the plugin itself has no dependency on it)
  const mm = join(DEV, 'tools', 'mermaid', 'parse.mjs');
  if (existsSync(mm)) {
    const pr = spawnSync(process.execPath, [mm, join(work, '.ts-optimize', 'runs', runId, 'codebase-health.md')], { encoding: 'utf8' });
    assert.equal(pr.status, 0, `mermaid.parse: ${pr.stdout}${pr.stderr}`.slice(0, 600));
    assert.match(pr.stdout, /1 block\(s\), 0 invalid/);
  }
  // refused diagrams
  const bad = T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', 'src/wrapper.ts', '--line', '3', '--recommendation', 'STRONG', '--touch', 'src/wrapper.ts', '--mermaid', 'pie title nope');
  assert.equal(bad.status, 2); assert.match(bad.text, /flowchart TD/);
  const six = T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', 'src/wrapper.ts', '--line', '3', '--recommendation', 'STRONG', ...['src/wrapper.ts', 'src/index.ts', 'src/cli.ts', 'src/errors.ts', 'src/flags.ts', 'src/types.ts'].flatMap((f) => ['--touch', f]));
  assert.equal(six.status, 2); assert.match(six.text, /at most 5 files/);
});

test('5.5b no hot module: structure triage says so and writes no chunk', () => {
  const work = ensureFixture('F01', { reset: true });
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  assert.equal(dated(work, '2024-01-01T10:00:00', 'commit', '--amend', '--no-edit', '--date=2024-01-01T10:00:00').status, 0);
  auditFixture('F01', { mode: 'deep', reset: false });
  const r = ok(T(work, 'triage', 'plan', '--kind', 'structure')).json.result;
  assert.deepEqual(r.chunks, []); assert.ok(r.cold_excluded >= 10);
});

const tcli = (work, ...a) => T(work, ...a);
function deepRun(rule) {
  const work = auditFixture('F01', { mode: 'deep' });
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  const runId = latestRun(work);
  ok(tcli(work, 'run', 'begin'), 'run begin');
  ok(tcli(work, 'plan', 'check', '--rule', rule), 'plan check');
  ok(tcli(work, 'plan', 'lock'), 'lock');
  return { work, runId };
}

test('5.2 R wave on the seeded passthrough wrapper: inlined, diff shape passes, tests untouched, gate green; editing a test assertion in the same commit is refused (exit 7)', () => {
  const { work, runId } = deepRun('struct-03');
  const f = allFindings(work, runId).find((x) => x.front.rule === 'struct-03');
  assert.equal(f.front.wave, 'R'); assert.deepEqual(f.front.touches.includes('src/wrapper.ts'), true);
  ok(tcli(work, 'run', 'wave', 'begin', 'R'), 'wave R');
  const consumers = f.front.touches.filter((t) => t !== 'src/wrapper.ts');
  assert.ok(consumers.length >= 1, `the consumer is in touches: ${f.front.touches}`);
  // variant first: the same edit plus a changed test assertion is refused
  const consumer = consumers.find((t) => readFileSync(join(work, t), 'utf8').includes('lengthOf'));
  const inline = () => edit(work, consumer, (t) => t.replace(/import \{ lengthOf \} from ["']\.\/wrapper(?:\.ts|\.js)?["'];?/, 'import { slugLength } from "./internal.ts";').replace(/\blengthOf\b/g, 'slugLength'));
  inline();
  ok(tcli(work, 'remove', f.front.id, '--file', 'src/wrapper.ts'), 'remove wrapper');
  const testFile = join(work, 'test', 'testonly.test.ts');
  const before = readFileSync(testFile, 'utf8');
  writeFileSync(testFile, before.replace(/toBe\((\d+)\)/, (m, n) => `toBe(${Number(n) + 1})`).replace(/toEqual\(/, 'toEqual(') + (before.match(/toBe\(\d+\)/) ? '' : '\nexpect(1).toBe(1);\n'));
  const refused = tcli(work, 'commit', f.front.id, '-m', 'inline lengthOf');
  assert.equal(refused.status, 7, refused.text.slice(0, 800));
  assert.match(refused.text, /outside the named findings' touches|test assertion lines changed/);
  git(work, 'checkout', '--', 'test/testonly.test.ts');
  // the clean version commits and the gate is green
  const c = ok(tcli(work, 'commit', f.front.id, '-m', 'inline lengthOf into its only caller'), 'commit');
  assert.deepEqual(c.json.result.trailers.Rule, ['struct-03']);
  assert.equal(git(work, 'diff', '--name-only', 'HEAD~1', 'HEAD').stdout.split('\n').filter((x) => x.startsWith('test/')).length, 0, 'tests untouched');
  ok(tcli(work, 'gate', '--wave', 'R'), 'gate R');
  ok(tcli(work, 'run', 'wave', 'end', 'R'));
});

test('semantic invariance (doc 06 §6): new control flow in a refactor commit is refused unless the finding allows it', () => {
  const { work, runId } = deepRun('struct-03');
  const f = allFindings(work, runId).find((x) => x.front.rule === 'struct-03');
  ok(tcli(work, 'run', 'wave', 'begin', 'R'));
  const consumer = f.front.touches.find((t) => t !== 'src/wrapper.ts' && readFileSync(join(work, t), 'utf8').includes('lengthOf'));
  edit(work, consumer, (t) => t.replace(/import \{ lengthOf \} from ["']\.\/wrapper(?:\.ts|\.js)?["'];?/, 'import { slugLength } from "./internal.ts";').replace(/\blengthOf\(([^)]*)\)/g, 'slugLength($1 ?? "")'));
  ok(tcli(work, 'remove', f.front.id, '--file', 'src/wrapper.ts'));
  const r = tcli(work, 'commit', f.front.id, '-m', 'inline lengthOf');
  assert.equal(r.status, 7, r.text.slice(0, 800));
  assert.match(r.text, /added control flow/);
});

test('5.3 struct-07: the three cn copies are one finding; one canonical module, call sites redirected, duplicates deleted, gate green, rescan finds no new dead files', () => {
  const { work, runId } = deepRun('struct-07');
  const fs07 = allFindings(work, runId).filter((x) => x.front.rule === 'struct-07');
  assert.equal(fs07.length, 1, 'one consolidation per helper name');
  const f = fs07[0];
  assert.deepEqual(f.front.members.map((m) => m.file).sort(), ['src/forms/cn.ts', 'src/layout/cn.ts', 'src/ui/cn.ts']);
  assert.ok(f.front.touches.includes('src/index.ts'), 'the call site is in touches');
  assert.ok(!allFindings(work, runId).some((x) => x.front.rule === 'struct-08' && x.front.state === 'open'), 'struct-08 on the same files is superseded by struct-07');
  ok(tcli(work, 'run', 'wave', 'begin', 'R'), 'wave R');
  edit(work, 'src/index.ts', (t) => t.replace('"./forms/cn.ts"', '"./ui/cn.ts"').replace('"./layout/cn.ts"', '"./ui/cn.ts"'));
  ok(tcli(work, 'remove', f.front.id, '--file', 'src/forms/cn.ts'));
  ok(tcli(work, 'remove', f.front.id, '--file', 'src/layout/cn.ts'));
  const c = ok(tcli(work, 'commit', f.front.id, '-m', 'consolidate cn into src/ui/cn.ts'), 'commit');
  assert.deepEqual(c.json.result.files.sort(), ['src/forms/cn.ts', 'src/index.ts', 'src/layout/cn.ts']);
  assert.equal(existsSync(join(work, 'src/ui/cn.ts')), true);
  ok(tcli(work, 'gate', '--wave', 'R'), 'gate R');
  const rs = ok(tcli(work, 'rescan', '--wave', 'R'), 'rescan');
  assert.deepEqual(rs.json.result.new_cascades, [], 'no new dead files after the consolidation');
  ok(tcli(work, 'run', 'wave', 'end', 'R'));
  ok(tcli(work, 'validate'));
});

test('5.4 F06 deep: the plat-01 and plat-02 assisted fixes of the b-toml worker are applied; the protected ctx.waitUntil count is intact; a fix that drops one is refused', () => {
  const work = auditFixture('F06', { mode: 'deep' });
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  const runId = latestRun(work);
  const f = (rule) => allFindings(work, runId).find((x) => x.front.rule === rule && x.front.location.file === 'variants/b-toml/src/index.ts');
  const p01 = f('plat-01'); const p02 = f('plat-02');
  assert.equal(p01.front.wave, 'R'); assert.equal(p02.front.wave, 'R');
  ok(tcli(work, 'run', 'begin'), 'run begin');
  const planFile = join(work, '.ts-optimize', 'runs', runId, 'plan.md');
  writeFileSync(planFile, readFileSync(planFile, 'utf8').replace(new RegExp(`- \\[ \\] (${p01.front.id}|${p02.front.id}) `, 'g'), '- [x] $1 '));
  const lock = ok(tcli(work, 'plan', 'lock'), 'lock');
  assert.equal(lock.json.result.approved, 2);
  ok(tcli(work, 'run', 'wave', 'begin', 'R'), 'wave R');
  const idx = 'variants/b-toml/src/index.ts';
  const waitUntils = () => (readFileSync(join(work, idx), 'utf8').match(/ctx\.waitUntil\(/g) || []).length;
  const before = waitUntils();
  // a plat-02 "fix" that deletes an existing waitUntil is refused (fire-and-forget work would be cancelled)
  edit(work, idx, (t) => t.replace('    ctx.waitUntil(logHit(url.pathname));\n', '    logHit(url.pathname);\n'));
  const refused = tcli(work, 'commit', p02.front.id, '-m', 'wait for the cache write');
  assert.equal(refused.status, 7, refused.text.slice(0, 800)); assert.match(refused.text, /ctx\.waitUntil\( occurrences decrease/);
  git(work, 'checkout', '--', idx);
  // the right fix: add one, drop none
  edit(work, idx, (t) => t.replace('env.CACHE.put(', 'ctx.waitUntil(env.CACHE.put(').replace('new Date().toISOString());', 'new Date().toISOString()));'));
  ok(tcli(work, 'commit', p02.front.id, '-m', 'keep the cache write alive with ctx.waitUntil'), 'commit plat-02');
  // plat-01: read the value from the env binding instead of process.env (the runtime here does not populate process.env)
  edit(work, idx, (t) => t.replace('process.env.LOG_LEVEL', 'env.LOG_LEVEL'));
  ok(tcli(work, 'commit', p01.front.id, '-m', 'read LOG_LEVEL from the env binding'), 'commit plat-01');
  assert.equal(waitUntils(), before + 1, 'one more ctx.waitUntil than before, none lost');
  const g = ok(tcli(work, 'gate', '--wave', 'R'), 'gate R');
  assert.equal(g.json.result.legs.typecheck.status, 'pass');
  assert.equal(g.json.result.legs.test.status, 'pass', JSON.stringify(g.json.result.legs.test).slice(0, 800));
  ok(tcli(work, 'run', 'wave', 'end', 'R'));
});
