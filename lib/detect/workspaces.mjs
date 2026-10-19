// Workspace sources merged (doc 05 §3): pnpm-workspace.yaml, package.json#workspaces, lerna.json, rush.json, nx project.json.
import { join } from 'node:path';
import { readJsonc, readText } from '../core/fs.mjs';
import { filterGlobs } from '../core/glob.mjs';
import { tryParseYaml } from '../core/yaml-subset.mjs';
import { dirOf } from './manifests.mjs';

/**
 * -> { sources:[names], patterns:[glob], members:[relDir] (dirs that contain a package.json, '' = root excluded), inferred:boolean }
 */
export function detectWorkspaces(root, manifests) {
  const sources = []; let patterns = [];
  const add = (name, pats) => { if (pats && pats.length) { sources.push(name); patterns = patterns.concat(pats); } };

  const pw = readText(join(root, 'pnpm-workspace.yaml'));
  if (pw !== null) {
    const y = tryParseYaml(pw);
    if (y.ok && y.value && Array.isArray(y.value.packages)) add('pnpm-workspace.yaml', y.value.packages.filter((p) => typeof p === 'string'));
    else sources.push('pnpm-workspace.yaml');
  }
  const rootPkg = readJsonc(join(root, 'package.json'));
  if (rootPkg.ok && rootPkg.value) {
    const w = rootPkg.value.workspaces;
    if (Array.isArray(w)) add('package.json#workspaces', w.filter((p) => typeof p === 'string'));
    else if (w && Array.isArray(w.packages)) add('package.json#workspaces', w.packages.filter((p) => typeof p === 'string'));
  }
  const lerna = readJsonc(join(root, 'lerna.json'));
  if (lerna.ok && lerna.value) add('lerna.json', Array.isArray(lerna.value.packages) ? lerna.value.packages : ['packages/*']);
  const rush = readJsonc(join(root, 'rush.json'));
  if (rush.ok && rush.value && Array.isArray(rush.value.projects)) add('rush.json', rush.value.projects.map((p) => p.projectFolder).filter(Boolean));
  for (const m of manifests.markers) if (m === 'turbo.json' || m === 'nx.json') sources.push(m);

  const pkgDirs = manifests.packageJsons.map(dirOf).filter((d) => d !== '');
  const positive = patterns.filter((p) => !p.startsWith('!'));
  let members = [];
  if (patterns.length && positive.length) members = filterGlobs(pkgDirs, patterns.map((p) => p.replace(/\/$/, '')));
  let inferred = false;
  if (!members.length && !positive.length) {
    const shallow = pkgDirs.filter((d) => d.split('/').length <= 2);
    if (shallow.length > 1 || (shallow.length === 1 && manifests.packageJsons.includes('package.json'))) { members = shallow.sort(); inferred = shallow.length > 0; }
    else if (shallow.length === 1) { members = shallow; inferred = true; }
  }
  return { sources: [...new Set(sources)], patterns, members, inferred };
}
