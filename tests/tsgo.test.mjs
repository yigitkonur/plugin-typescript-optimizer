// Row 4.2 / 4.8 driven through the CLI on F08 (TypeScript 5.9 project with legacy config, ts-node, ts-morph, typescript-eslint):
// scan --mode tsgo -> ingest -> run begin (branch chore/upgrade-typescript-go) -> T1, T2, T4 with scripted edits -> six-tier gates -> finish.
// The live LLM run of /ts-optimize:tsgo is in tests/transcripts; here the model's edits are plain file writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture, workDir } from './harness/fixture.mjs';
import { git } from './harness/applying.mjs';
import { latestRun } from './harness/fixrun.mjs';

process.env.TSOPT_NS = 'tsgo-adopt';
const BIN = join(REPO, 'bin', 'ts-opt');
const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' };
const T = (work, ...a) => { const r = spawnSync(process.execPath, [BIN, ...a, '--json', '--cwd', work], { cwd: work, encoding: 'utf8', env, timeout: 900_000 }); let json = null; try { json = JSON.parse(r.stdout); } catch { /* text */ } return { status: r.status, json, text: r.stdout + r.stderr }; };
const ok = (r, what = '') => { assert.equal(r.status, 0, `${what}\n${r.text.slice(0, 2500)}`); return r; };
const rd = (w, f) => readFileSync(join(w, f), 'utf8');
const wr = (w, f, t) => writeFileSync(join(w, f), t);
const out = (w, ...a) => git(w, ...a).stdout.trim();
const bin = (w, name, ...a) => spawnSync(join(w, 'node_modules', '.bin', name), a, { cwd: w, encoding: 'utf8' });

test('4.2 + 4.8 live-shaped adoption of F08: T1 config, T2 alias scheme + tsx, T4 CI; tsc 7 with require("typescript") on 6; six tiers green; finished', () => {
  rmSync(workDir('F08'), { recursive: true, force: true }); // the test swaps the compiler in node_modules: start from a fresh clone
  const work = ensureFixture('F08', { reset: true });
  git(work, 'config', 'user.name', 'fixture'); git(work, 'config', 'user.email', 'fixture@example.invalid'); git(work, 'config', 'commit.gpgsign', 'false');
  ok(T(work, 'scan', '--mode', 'tsgo', '--domains', 'toolchain', '--abandon-open', '--quiet'));
  ok(T(work, 'findings', 'ingest'));
  const runId = latestRun(work);
  const list = ok(T(work, 'findings', 'list')).json.result.findings;
  const id = (rule, file) => list.find((f) => f.rule === rule && (!file || f.file === file)).id;
  const f1 = id('tc-02', 'src/cli.ts'); const f2 = id('tc-01'); const f4 = id('tc-04'); const f5 = id('tc-05'); const f6 = id('tc-06');
  assert.ok(!list.some((f) => f.rule === 'tc-02' && f.file === 'tsconfig.json' && f.state === 'open'), 'the baseUrl line is one finding (tc-01), the tc-02 duplicate is superseded');
  const b = ok(T(work, 'run', 'begin'), 'run begin');
  assert.equal(b.json.result.branch, 'chore/upgrade-typescript-go');
  ok(T(work, 'plan', 'check'));
  const lock = ok(T(work, 'plan', 'lock'), 'lock');
  assert.equal(lock.json.result.approved, 5);
  assert.deepEqual(ok(T(work, 'run', 'status')).json.result.waves_pending, ['T1', 'T2', 'T4']);

  // ---- T1: configuration (the import first: it still needs baseUrl to resolve) ------------------------------------------
  ok(T(work, 'run', 'wave', 'begin', 'T1'));
  wr(work, 'src/cli.ts', rd(work, 'src/cli.ts').replace('from "utils/format"', 'from "./utils/format"'));
  ok(T(work, 'commit', f1, '-m', 'import utils/format relatively'), 'commit f1');
  wr(work, 'tsconfig.json', JSON.stringify({
    compilerOptions: { target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', lib: ['es2022'], types: ['node'], esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, outDir: 'dist' },
    include: ['src', 'scripts', 'test'], 'ts-node': { compilerOptions: { module: 'commonjs' } },
  }, null, 2) + '\n');
  ok(T(work, 'commit', f2, '-m', 'modernise compiler options'), 'commit f2');
  const g1 = ok(T(work, 'gate', '--wave', 'T1'), 'gate T1');
  assert.equal(g1.json.result.legs.typecheck.status, 'pass');
  assert.equal(g1.json.result.legs.test.status, 'pass');
  assert.equal(g1.json.result.legs.build.status, 'pass');
  ok(T(work, 'run', 'wave', 'end', 'T1'));

  // ---- T2: alias scheme (tsc native, require('typescript') stays 6) and tsx instead of ts-node -----------------------------
  ok(T(work, 'run', 'wave', 'begin', 'T2'));
  const pj = JSON.parse(rd(work, 'package.json'));
  pj.devDependencies.typescript = 'npm:@typescript/typescript6@^6';
  pj.devDependencies['@typescript/native'] = 'npm:typescript@^7';
  wr(work, 'package.json', JSON.stringify(pj, null, 2) + '\n');
  const inst = ok(T(work, 'pm', 'install'), 'pm install (alias scheme)');
  assert.ok(inst.json.result.changed.includes('package-lock.json'), inst.text);
  const chk = ok(T(work, 'check'), 'check after the switch').json.result;
  assert.equal(chk.passed, true);
  assert.equal(chk.engine.kind, 'native', 'tsc is now the native compiler');
  ok(T(work, 'commit', f4, '-m', 'attach the TypeScript 6 bridge and switch tsc to the native compiler'), 'commit f4');
  // 4.8: both versions at once
  assert.match(bin(work, 'tsc', '--version').stdout, /Version 7\.\d+\.\d+/);
  const api = spawnSync(process.execPath, ['-e', "console.log(require('typescript').version)"], { cwd: work, encoding: 'utf8' });
  assert.match(api.stdout.trim(), /^6\.\d+\.\d+/);
  const pj2 = JSON.parse(rd(work, 'package.json'));
  pj2.scripts.dev = 'tsx src/cli.ts'; pj2.scripts.rename = 'tsx scripts/rename.ts';
  delete pj2.devDependencies['ts-node']; pj2.devDependencies.tsx = '^4.20.0';
  wr(work, 'package.json', JSON.stringify(pj2, null, 2) + '\n');
  ok(T(work, 'pm', 'install'), 'pm install (tsx)');
  ok(T(work, 'commit', f5, '-m', 'replace ts-node with tsx'), 'commit f5');
  const g2 = ok(T(work, 'gate', '--wave', 'T2'), 'gate T2');
  for (const leg of ['typecheck', 'lint', 'test', 'build']) assert.equal(g2.json.result.legs[leg].status, 'pass', `${leg}: ${JSON.stringify(g2.json.result.legs[leg]).slice(0, 600)}`);
  ok(T(work, 'run', 'wave', 'end', 'T2'));
  const brief = ok(T(work, 'detect', '--refresh')).json.result;
  assert.equal(brief.compilers.authoritative.kind, 'native');
  assert.equal(brief.compilers.api_provider.version.split('.')[0], '6');

  // ---- T4: CI ---------------------------------------------------------------------------------------------------------------
  ok(T(work, 'run', 'wave', 'begin', 'T4'));
  wr(work, '.github/workflows/ci.yml', rd(work, '.github/workflows/ci.yml').replace(' --v8-pool-size=4', ''));
  ok(T(work, 'commit', f6, '-m', 'drop the worker-incompatible NODE_OPTIONS flag'), 'commit f6');
  ok(T(work, 'gate', '--wave', 'T4'), 'gate T4');
  ok(T(work, 'run', 'wave', 'end', 'T4'));
  const p = ok(T(work, 'gate', '--wave', 'P'), 'gate P');
  assert.equal(p.json.result.passed, true);
  const fin = ok(T(work, 'run', 'finish'), 'finish');
  assert.equal(fin.json.result.applied, 5);
  assert.equal(out(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'chore/upgrade-typescript-go');
  assert.ok(existsSync(join(work, '.ts-optimize', 'runs', runId, 'apply', 'ledger.md')));
  ok(T(work, 'validate'));
  assert.doesNotMatch(rd(work, '.github/workflows/ci.yml'), /v8-pool-size/);
});
