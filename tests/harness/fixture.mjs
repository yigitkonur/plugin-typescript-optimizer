#!/usr/bin/env node
// Materialize a fixture repo outside the plugin repo, install its deps once, reset between runs.
//   node tests/harness/fixture.mjs <Fxx> [--reset] [--clean]   -> prints the work dir (last stdout line)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const DEV = process.env.TS_OPT_DEV || join(homedir(), '.cache', 'ts-optimize-dev');
export const TOOLS = join(DEV, 'tools', 'node_modules', '.bin');
const FIXTURES = join(REPO, 'tests', 'fixtures');

function log(...a) { process.stderr.write(a.join(' ') + '\n'); }

export function fixtureDir(id) {
  const hit = readdirSync(FIXTURES).find((n) => n === id || n.startsWith(id + '-'));
  if (!hit) throw new Error(`no fixture matching ${id} in ${FIXTURES}`);
  return join(FIXTURES, hit);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    if (n === 'node_modules' || n === '.git') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function treeHash(dir) {
  const h = createHash('sha256');
  for (const f of walk(dir)) { h.update(relative(dir, f)); h.update('\0'); h.update(readFileSync(f)); h.update('\0'); }
  return h.digest('hex');
}

function run(argv, cwd, timeoutMs = 300_000) {
  const [cmd, ...args] = argv.map((a) => a.replace('{TOOLS}', TOOLS));
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
  if (r.status !== 0) throw new Error(`${argv.join(' ')} failed (exit ${r.status}${r.error ? ', ' + r.error.message : ''})\n${(r.stdout || '').slice(-800)}\n${(r.stderr || '').slice(-800)}`);
  return r;
}

const git = (cwd, ...args) => run(['git', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], cwd);

const IGNORES = ['node_modules/', '.pnp.*', '.yarn/cache/', '.yarn/unplugged/', '.yarn/install-state.gz', 'dist/', '*.tsbuildinfo'];

export function ensureFixture(id, { reset = false, clean = false } = {}) {
  const src = fixtureDir(id);
  const work = join(DEV, 'work', id);
  const stamp = join(DEV, 'work', id + '.hash');
  const want = treeHash(src);
  const have = existsSync(stamp) ? readFileSync(stamp, 'utf8') : '';
  mkdirSync(join(DEV, 'work'), { recursive: true });
  if (!existsSync(work) || have !== want) {
    rmSync(work, { recursive: true, force: true });
    cpSync(src, work, { recursive: true });
    const meta = JSON.parse(readFileSync(join(src, 'fixture.json'), 'utf8'));
    if (meta.install) { log(`[fixture ${id}] install: ${meta.install.join(' ')}`); run(meta.install, work); }
    const gi = join(work, '.gitignore');
    const prev = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    writeFileSync(gi, prev + (prev && !prev.endsWith('\n') ? '\n' : '') + IGNORES.filter((l) => !prev.includes(l)).join('\n') + '\n');
    git(work, 'init', '-b', 'main');
    git(work, 'add', '-A');
    git(work, 'commit', '-m', `fixture ${id}`);
    writeFileSync(stamp, want);
  } else if (reset || clean) {
    git(work, 'reset', '--hard');
    git(work, 'clean', '-fd');
    if (clean) git(work, 'clean', '-fdx', '-e', 'node_modules', '-e', '.pnp.*', '-e', '.yarn');
    rmSync(join(work, '.ts-optimize'), { recursive: true, force: true });
    // fixtures may have moved branches/tags during a run: go back to main
    git(work, 'checkout', '-f', 'main');
    for (const b of run(['git', 'branch', '--format=%(refname:short)'], work).stdout.split('\n').filter((x) => x && x !== 'main')) git(work, 'branch', '-D', b);
    for (const t of run(['git', 'tag', '-l'], work).stdout.split('\n').filter(Boolean)) git(work, 'tag', '-d', t);
  }
  return work;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, ...flags] = process.argv.slice(2);
  if (!id) { log('usage: fixture.mjs <Fxx> [--reset] [--clean]'); process.exit(2); }
  try { console.log(ensureFixture(id, { reset: flags.includes('--reset'), clean: flags.includes('--clean') })); }
  catch (e) { log(String(e.message || e)); process.exit(1); }
}
