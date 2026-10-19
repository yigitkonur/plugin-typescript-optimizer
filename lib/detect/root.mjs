// Repo root resolution (doc 05 §1).
import { dirname, join, resolve } from 'node:path';
import { exists, isFile, walkUp } from '../core/fs.mjs';
import { topLevel } from '../core/git.mjs';

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json'];

export async function findRoot(cwd) {
  const start = resolve(cwd);
  const top = await topLevel(start);
  if (top) return { root: top, git: true };
  const g = walkUp(start, (d) => exists(join(d, '.git')));
  if (g) return { root: g.dir, git: true };
  // highest ancestor with a workspace marker
  let marker = null;
  walkUp(start, (d) => { if (WORKSPACE_MARKERS.some((m) => isFile(join(d, m)))) marker = d; return false; });
  if (marker) return { root: marker, git: false };
  const p = walkUp(start, (d) => isFile(join(d, 'package.json')));
  if (p) return { root: p.dir, git: false };
  return { root: start, git: false };
}
export { dirname };
