// One pass over the file index: find manifests (package.json, tsconfig*, workspace markers, wrangler, deno, lockfiles).
import { basename, dirname } from 'node:path';
import { listFiles } from '../core/files.mjs';

const TSCONFIG = /^(tsconfig(\..+)?|jsconfig)\.json$/;
const WRANGLER = /^wrangler\.(jsonc?|toml)$/;
const LOCKS = new Set(['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'deno.lock']);
const MARKERS = new Set(['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json', 'deno.json', 'deno.jsonc', '.yarnrc.yml', '.pnp.cjs']);

/** -> { packageJsons:[relpath], tsconfigs:[relpath], wrangler:[relpath], locks:[relpath], markers:[relpath], all:[relpath] } (posix, repo-relative) */
export async function scanManifests(root, inGit) {
  const files = await listFiles(root, ['*.json', '*.jsonc', '*.toml', '*.yaml', '*.yml', '*.lock', '*.lockb', '*.cjs'], { inGit, maxDepth: 5 });
  const out = { packageJsons: [], tsconfigs: [], wrangler: [], locks: [], markers: [], all: files };
  for (const f of files) {
    const b = basename(f);
    if (b === 'package.json') out.packageJsons.push(f);
    else if (TSCONFIG.test(b)) out.tsconfigs.push(f);
    else if (WRANGLER.test(b)) out.wrangler.push(f);
    else if (LOCKS.has(b)) out.locks.push(f);
    else if (MARKERS.has(b)) out.markers.push(f);
  }
  return out;
}
export const dirOf = (f) => { const d = dirname(f); return d === '.' ? '' : d; };
