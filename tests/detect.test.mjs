// Phase 0 acceptance rows 0.2–0.8. Needs the fixtures materialised (tests/harness/fixture.mjs); run with `node --test tests/*.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, ensureFixture } from './harness/fixture.mjs';
import { normalize, stableDetect } from './harness/stable.mjs';

process.env.TSOPT_NS = 'detect'; // own fixture copies: test files run in parallel
const BIN = join(REPO, 'bin', 'ts-opt');
const HOME = mkdtempSync(join(tmpdir(), 'tsopt-home-'));
const cli = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TS_OPT_HOME: HOME, ...env } });
const detectJson = (dir) => { const r = cli(['detect', '--json', '--refresh', '--cwd', dir], dir); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).result; };
const golden = (name) => JSON.parse(readFileSync(join(REPO, 'tests', 'golden', name), 'utf8'));

test('0.2 no TypeScript (F10): brief says none, exit 0, nothing written', () => {
  const dir = ensureFixture('F10', { reset: true });
  const r = cli(['detect', '--brief', '--cwd', dir], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^typescript: none/);
  assert.equal(existsSync(join(dir, '.ts-optimize')), false);
  const x = cli(['doctor', '--cwd', dir], dir);
  assert.equal(x.status, 0);
  assert.match(x.stdout, /No TypeScript found/);
});

test('0.3 F01 detect matches the golden', () => {
  const dir = ensureFixture('F01', { reset: true });
  const d = detectJson(dir);
  assert.deepEqual(normalize(stableDetect(d), { root: d.root }), golden('F01-detect.json'));
});

test('0.4 F02: 7 workspace packages, "!" exclusion honoured, solution tsc -b', () => {
  const d = detectJson(ensureFixture('F02', { reset: true }));
  const members = d.packages.filter((p) => !p.workspace_root).map((p) => p.path).sort();
  assert.deepEqual(members, ['apps/api', 'apps/cli', 'apps/web', 'packages/core', 'packages/types', 'packages/ui', 'packages/utils']);
  assert.ok(!members.includes('packages/legacy'));
  const tc = d.gate.legs.filter((l) => l.id === 'typecheck');
  assert.equal(tc.length, 1);
  assert.equal(tc[0].variant, 'tsc-b');
  assert.equal(d.pm.name, 'pnpm');
});

test('0.5 F03: Yarn PnP resolved as `yarn run`, works with no node_modules', () => {
  const dir = ensureFixture('F03', { reset: true });
  assert.equal(existsSync(join(dir, 'node_modules')), false);
  const d = detectJson(dir);
  assert.equal(d.pm.name, 'yarn'); assert.equal(d.pm.pnp, true);
  assert.deepEqual(d.compilers.authoritative.exec, ['yarn', 'run', 'tsc']);
  assert.deepEqual(d.gate.legs.find((l) => l.id === 'test').argv, ['yarn', 'run', 'test']);
});

test('0.6 F09 polyglot: one TS package (web/), Python never read', () => {
  const src = ensureFixture('F09', { reset: true });
  const dir = join(mkdtempSync(join(tmpdir(), 'tsopt-poly-')), 'F09');
  cpSync(src, dir, { recursive: true });
  for (const d of ['app', 'tests']) if (existsSync(join(dir, d))) chmodSync(join(dir, d), 0o000);
  try {
    const d = detectJson(dir);
    assert.deepEqual(d.packages.map((p) => p.path), ['web']);
    assert.equal(d.gate.legs.find((l) => l.id === 'test').cwd, 'web');
    assert.equal(d.packages[0].pm.name, 'npm');
  } finally { for (const d of ['app', 'tests']) if (existsSync(join(dir, d))) chmodSync(join(dir, d), 0o755); rmSync(dir, { recursive: true, force: true }); }
});

test('0.7 malformed config files never throw out of detect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsopt-bad-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{ "name": "x", "dependencies": { "typescript": "5" '); // truncated
    writeFileSync(join(dir, 'tsconfig.json'), '﻿{ "extends": ["./nope", 42], "compilerOptions": { /* c */ "strict": true, }, ');
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - [unclosed\n\t- bad');
    writeFileSync(join(dir, 'wrangler.toml'), 'name = "x\n[[bad');
    const r = cli(['detect', '--json', '--refresh', '--cwd', dir], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('0.8 no git: doctor exits 0 and says so; worktree root is detected', () => {
  const src = ensureFixture('F01', { reset: true });
  const nogit = join(mkdtempSync(join(tmpdir(), 'tsopt-nogit-')), 'p');
  cpSync(src, nogit, { recursive: true, filter: (f) => !f.endsWith('/.git') && !f.includes('/.git/') });
  const x = cli(['doctor', '--cwd', nogit], nogit);
  assert.equal(x.status, 0);
  assert.match(x.stdout, /not a git repo/);
  assert.match(x.stdout, /not a git repository/);
  const wt = join(mkdtempSync(join(tmpdir(), 'tsopt-wt-')), 'wt');
  const g = spawnSync('git', ['-C', src, 'worktree', 'add', '-f', '-b', 'wt-test', wt], { encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  try {
    const d = detectJson(join(wt));
    assert.equal(d.root.endsWith('/wt'), true); assert.equal(d.git.repo, true);
    mkdirSync(join(wt, 'src', 'deep'), { recursive: true });
    assert.equal(detectJson(join(wt, 'src', 'deep')).root, d.root);
  } finally { spawnSync('git', ['-C', src, 'worktree', 'remove', '--force', wt]); spawnSync('git', ['-C', src, 'branch', '-D', 'wt-test']); }
});
