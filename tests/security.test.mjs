// Regression tests for the security review of the guards and the artifact tree: the rg secret rc stays in sync with
// secret-paths.json and really excludes secrets; concurrent `proposal add` calls queue behind the run lock; a symlink
// planted under .ts-optimize/ or in --touch is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV, REPO } from './harness/fixture.mjs';
import { auditFixture, latestRun } from './harness/fixrun.mjs';

process.env.TSOPT_NS = 'security';
const BIN = join(REPO, 'bin', 'ts-opt');
const env = { ...process.env, TS_OPT_HOME: join(DEV, 'home'), CI: '1' };
const T = (work, ...a) => { const r = spawnSync(process.execPath, [BIN, ...a, '--json', '--cwd', work], { cwd: work, encoding: 'utf8', env, timeout: 120_000 }); return { status: r.status, out: r.stdout + r.stderr }; };
const Tasync = (work, ...a) => new Promise((resolve) => {
  const p = spawn(process.execPath, [BIN, ...a, '--json', '--cwd', work], { cwd: work, env });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (status) => resolve({ status, out }));
});

test('rg-secrets.rc is exactly what secret-paths.json says', () => {
  const globs = JSON.parse(readFileSync(join(REPO, 'catalog', 'secret-paths.json'), 'utf8')).globs;
  const rc = readFileSync(join(REPO, 'catalog', 'rg-secrets.rc'), 'utf8').split('\n').filter((l) => l.startsWith('--glob='));
  assert.deepEqual(rc, globs.map((g) => `--glob=!${g}`));
});

const HAS_RG = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
test('rg with the rc never reports a hit inside a secret path', { skip: !HAS_RG && 'ripgrep is not installed' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'tsopt-sec-'));
  try {
    mkdirSync(join(d, 'src')); mkdirSync(join(d, 'certs'));
    for (const f of ['src/a.ts', '.env', '.env.production', 'certs/server.key', '.npmrc']) writeFileSync(join(d, f), 'CANARY_VALUE\n');
    const r = spawnSync('rg', ['-l', 'CANARY_VALUE', '--hidden', '--no-ignore'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RIPGREP_CONFIG_PATH: join(REPO, 'catalog', 'rg-secrets.rc') } });
    assert.equal(r.stdout.trim(), 'src/a.ts');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const MERMAID = 'flowchart TD\\n  subgraph Before\\n    a[a] --> b[b]\\n  end\\n  subgraph After\\n    a2[a] --> b2[b]\\n  end';
const propose = (work, file, i) => Tasync(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', file, '--line', String(i + 1), '--recommendation', 'WORTH_EXPLORING',
  '--deletion-test', `candidate ${i}`, '--seam-test', 'one adapter', '--touch', file, '--mermaid', MERMAID);

test('concurrent proposal add calls queue behind the run lock: distinct ids, valid artifacts, no lock error', async () => {
  const work = auditFixture('F01', { mode: 'deep' });
  const files = ['src/index.ts', 'src/internal.ts', 'src/wrapper.ts', 'src/errors.ts'];
  const rs = await Promise.all(files.map((f, i) => propose(work, f, i)));
  for (const r of rs) assert.equal(r.status, 0, r.out.slice(0, 600));
  const ids = rs.map((r) => JSON.parse(r.out).result.id);
  assert.equal(new Set(ids).size, ids.length, `ids collide: ${ids}`);
  const v = T(work, 'validate'); assert.equal(v.status, 0, v.out.slice(0, 600));
  const health = readFileSync(join(work, '.ts-optimize', 'runs', latestRun(work), 'codebase-health.md'), 'utf8');
  for (const id of ids) assert.ok(health.includes(id), `${id} missing from codebase-health.md`);
});

test('a symlink as --touch or --file that points outside the repository is refused', () => {
  const work = auditFixture('F01', { mode: 'deep' });
  const outside = mkdtempSync(join(tmpdir(), 'tsopt-out-'));
  try {
    writeFileSync(join(outside, 'secret.ts'), 'export const s = 1;\n');
    symlinkSync(join(outside, 'secret.ts'), join(work, 'src', 'linked.ts'));
    const r = T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', 'src/linked.ts', '--line', '1', '--recommendation', 'STRONG', '--touch', 'src/linked.ts');
    assert.equal(r.status, 2, r.out.slice(0, 600));
    assert.match(r.out, /outside the repository|not a file inside/);
  } finally { rmSync(join(work, 'src', 'linked.ts'), { force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('a symlink planted inside .ts-optimize/ makes every artifact command refuse', () => {
  const work = auditFixture('F01', { mode: 'deep' });
  const runId = latestRun(work);
  const outside = mkdtempSync(join(tmpdir(), 'tsopt-out-'));
  const link = join(work, '.ts-optimize', 'runs', runId, 'evil');
  try {
    symlinkSync(outside, link);
    const r = T(work, 'proposal', 'add', '--origin', 'architect', '--rule', 'struct-03', '--file', 'src/wrapper.ts', '--line', '1', '--recommendation', 'WORTH_EXPLORING', '--touch', 'src/wrapper.ts');
    assert.notEqual(r.status, 0, 'a symlinked artifact tree must not be written through');
    assert.match(r.out, /symbolic link/i);
  } finally { rmSync(link, { force: true }); rmSync(outside, { recursive: true, force: true }); }
});
