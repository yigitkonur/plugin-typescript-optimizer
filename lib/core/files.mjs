// File listing: git index first (honours .gitignore), bounded walk outside git. Prune list from doc 05 §1.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { run } from './proc.mjs';
import { toPosix } from './fs.mjs';

export const PRUNE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo',
  '.cache', '.output', '.wrangler', '.vercel', '.parcel-cache', 'storybook-static', '.yarn', '.pnpm-store', 'vendor', '.ts-optimize', '.quarantine']);
export const isPruned = (name) => PRUNE.has(name) || name.startsWith('.pnp.');

// pathspecs are git pathspecs, e.g. ['*.ts','*.tsx']. Returns repo-relative posix paths.
export async function listFiles(root, pathspecs = [], { inGit = true, maxDepth = 4, stopWhen = null } = {}) {
  if (inGit) {
    const r = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs],
      { cwd: root, timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024, stopWhen: stopWhen && ((s) => stopWhen(s.split('\0'))) });
    if (r.code === 0 || r.stoppedEarly) return r.stdout.split('\0').filter(Boolean).map(toPosix);
  }
  return walkFiles(root, pathspecs, maxDepth);
}

function matchSpec(name, specs) {
  if (!specs.length) return true;
  return specs.some((s) => {
    const m = /^\*\*\/(.+)$/.exec(s) || /^(\*.*)$/.exec(s);
    const pat = m ? m[1] : s;
    if (pat.startsWith('*')) return name.endsWith(pat.slice(1));
    return name === pat;
  });
}

export function walkFiles(root, specs = [], maxDepth = 4) {
  const out = [];
  const visit = (dir, depth) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (depth < maxDepth && !isPruned(e.name)) visit(join(dir, e.name), depth + 1); }
      else if (matchSpec(e.name, specs)) out.push(toPosix(relative(root, join(dir, e.name))));
    }
  };
  visit(root, 0);
  return out.sort();
}
export { statSync };
