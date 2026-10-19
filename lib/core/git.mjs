import { run } from './proc.mjs';

export async function git(cwd, args, opts = {}) {
  return run(['git', ...args], { cwd, timeoutMs: 20_000, ...opts });
}
export async function gitOut(cwd, args, opts) {
  const r = await git(cwd, args, opts);
  return r.code === 0 ? r.stdout.trim() : null;
}
export async function topLevel(cwd) { return gitOut(cwd, ['rev-parse', '--show-toplevel']); }
export async function head(cwd) { return gitOut(cwd, ['rev-parse', '--short', 'HEAD']); }
export async function branch(cwd) { return gitOut(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); }
// porcelain v1 entries, NUL separated, excluding .ts-optimize/
export async function statusPaths(cwd) {
  const r = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.code !== 0) return null;
  const out = [];
  const parts = r.stdout.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; const x = e[0]; const p = e.slice(3);
    if (x === 'R' || x === 'C') i++; // rename: next record is the origin path
    if (p === '.ts-optimize' || p.startsWith('.ts-optimize/')) continue;
    out.push({ status: e.slice(0, 2), path: p });
  }
  return out;
}
