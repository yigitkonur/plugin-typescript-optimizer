// "Is there TypeScript here?" — the silence test (doc 05 §1). Cheap, at most two git processes.
import { join } from 'node:path';
import { isDir, readJsonc, readText } from '../core/fs.mjs';
import { listFiles } from '../core/files.mjs';
import { dirOf } from './manifests.mjs';

const isDts = (f) => /\.d\.(m|c)?ts$/.test(f);

export async function detectPresence(root, inGit, manifests) {
  if (isDir(join(root, '.ts-optimize'))) return { yes: true, why: '.ts-optimize/ exists' };
  if (manifests.tsconfigs.some((f) => dirOf(f) === '' && /^tsconfig/.test(f))) return { yes: true, why: 'tsconfig in repo root' };
  let looked = 0;
  for (const f of manifests.packageJsons) {
    if (looked++ > 300) break;
    const r = readJsonc(join(root, f));
    const v = r.ok && r.value;
    if (!v) continue;
    if (['dependencies', 'devDependencies', 'peerDependencies'].some((k) => v[k] && v[k].typescript)) return { yes: true, why: `typescript dependency in ${f}` };
  }
  const found = await listFiles(root, ['*.ts', '*.tsx', '*.mts', '*.cts'], { inGit, maxDepth: 4, stopWhen: (parts) => parts.some((f) => f && !isDts(f)) });
  const hit = found.find((f) => !isDts(f));
  if (hit) return { yes: true, why: `TypeScript source ${hit}` };
  if (manifests.markers.some((m) => /(^|\/)deno\.jsonc?$/.test(m))) {
    const any = readText(join(root, 'deno.json')) ?? readText(join(root, 'deno.jsonc'));
    if (any !== null) return { yes: false, why: 'deno config without TypeScript sources' };
  }
  return { yes: false, why: 'no tsconfig, typescript dependency or TypeScript source file' };
}
