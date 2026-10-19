// detect(): the project model (doc 05 §1–§7, doc 02 §3.2a). Facts are read or probed, never guessed.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { sha1 } from '../core/hash.mjs';
import { mtimeKey, readText, readJsonc, writeAtomic, isFile, isDir } from '../core/fs.mjs';
import { branch as gitBranch, head as gitHead, statusPaths } from '../core/git.mjs';
import { tsOptHome } from '../core/home.mjs';
import { resolveCompilers } from './compilers.mjs';
import { detectLint, probeEngines } from './engines.mjs';
import { detectFrameworks, detectPacks } from './frameworks.mjs';
import { workerdInfo } from './packs.mjs';
import { buildGate } from './gate-legs.mjs';
import { scanManifests } from './manifests.mjs';
import { detectPackageManager } from './package-manager.mjs';
import { buildPackages } from './packages.mjs';
import { detectPresence } from './presence.mjs';
import { findRoot } from './root.mjs';
import { detectWorkspaces } from './workspaces.mjs';

async function gitInfo(root, isGit) {
  if (!isGit) return { repo: false, clean: null, branch: null, head: null };
  const [st, br, hd] = await Promise.all([statusPaths(root), gitBranch(root), gitHead(root)]);
  return { repo: true, clean: st === null ? null : st.length === 0, dirty_paths: st ? st.length : null, branch: br, head: hd };
}

function openRun(root) {
  const f = join(root, '.ts-optimize', 'state', 'open-run');
  const id = isFile(f) ? (readText(f) || '').trim() : '';
  if (!id) return null;
  const run = readJsonc(join(root, '.ts-optimize', 'runs', id, 'run.json'));
  return { id, state: run.ok ? run.value.state ?? null : null };
}

function cacheKey(root, manifests, home) {
  const parts = [process.version, process.env.PATH || '', home];
  for (const f of [...manifests.packageJsons, ...manifests.locks, ...manifests.markers]) parts.push(mtimeKey(join(root, f)));
  const dirs = [root, ...manifests.packageJsons.map((f) => join(root, f, '..'))];
  for (const d of dirs) for (const n of ['node_modules', 'node_modules/.bin']) parts.push(mtimeKey(join(d, n)));
  for (const n of ['toolbox', 'toolbox-native']) parts.push(mtimeKey(join(home, n)));
  return sha1(parts.join('\n'));
}

export async function detect(cwd, { refresh = false } = {}) {
  const { root, git: isGit } = await findRoot(cwd);
  const manifests = await scanManifests(root, isGit);
  const presence = await detectPresence(root, isGit, manifests);
  const git = await gitInfo(root, isGit);
  const base = { schema: 'ts-optimize/detect@1', typescript: presence.yes, why: presence.why, root, git, open_run: openRun(root) };
  if (!presence.yes) return { ...base, packages: [], pm: null, workspaces: null, compilers: null, engines: {}, lint: null, frameworks: [], packs: [], gate: { legs: [], unavailable: [] } };

  const ws = detectWorkspaces(root, manifests);
  const { rootPkg, packages, pkgJsonByDir } = buildPackages(root, manifests, ws);
  const pm = detectPackageManager(root, rootPkg);
  // package manager per package: its own lockfile / packageManager field first, then the root's (polyglot repos keep a lockfile in web/)
  const pmFor = (p) => {
    if (p.path === '.') return pm;
    const own = detectPackageManager(join(root, p.path), pkgJsonByDir.get(p.path) || null);
    if (own.source && own.source !== 'default' && own.name !== 'none') return own;
    return pm.source && pm.source !== 'default' ? pm : own;
  };
  for (const p of packages) p.pm = pmFor(p);
  const home = tsOptHome();
  const key = cacheKey(root, manifests, home);
  const cacheFile = join(home, 'cache', sha1(root).slice(0, 12) + '.json');
  let probed = null;
  if (!refresh && isFile(cacheFile)) { const c = readJsonc(cacheFile); if (c.ok && c.value.key === key) probed = c.value.probed; }
  if (!probed) {
    const pkgDirs = packages.map((p) => join(root, p.path === '.' ? '' : p.path));
    const toolboxBin = join(home, 'toolbox', 'node_modules', '.bin');
    const toolboxNative = join(home, 'toolbox-native', 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
    const [engines, ...comps] = await Promise.all([
      probeEngines({ root, pkgDirs, toolboxBin: existsSync(toolboxBin) ? toolboxBin : null }),
      ...packages.map((p) => resolveCompilers(join(root, p.path === '.' ? '' : p.path), root, { pm, toolboxNativeBin: toolboxNative })),
    ]);
    probed = { engines, compilers: Object.fromEntries(packages.map((p, i) => [p.path, comps[i]])) };
    try { writeAtomic(cacheFile, JSON.stringify({ key, probed })); } catch { /* cache is best effort */ }
  }
  for (const p of packages) p.compilers = probed.compilers[p.path] || null;
  const primary = packages.find((p) => !p.root_only && p.compilers && p.compilers.authoritative.kind !== 'none') || packages.find((p) => !p.root_only) || packages[0] || null;
  const depNames = new Set(packages.flatMap((p) => p.deps).concat(rootPkg ? Object.keys({ ...rootPkg.dependencies, ...rootPkg.devDependencies }) : []));
  const lint = detectLint(root, manifests, depNames, probed.engines);
  const gate = buildGate({ root, pm, packages, rootPkg, pmFor });
  return {
    ...base,
    pm: pm.name === 'none' ? (packages.map((p) => p.pm).find((x) => x && x.name !== 'none') || pm) : pm,
    workspaces: { sources: ws.sources, inferred: ws.inferred, members: ws.members.length },
    packages,
    compilers: primary ? { package: primary.path, ...primary.compilers } : null,
    engines: probed.engines,
    lint,
    frameworks: detectFrameworks(depNames, manifests),
    packs: withWorkerd(detectPacks(manifests, packages), root, manifests, packages),
    gate,
  };
}
export { isDir };

// the workerd pack carries what the rules need: per-variant compat settings and process_env_populated
function withWorkerd(packs, root, manifests, packages) {
  const info = workerdInfo(root, manifests, packages);
  const out = packs.filter((p) => p.name !== 'workerd');
  if (info.active) {
    const cur = packs.find((p) => p.name === 'workerd');
    out.push({ name: 'workerd', paths: cur ? cur.paths : info.variants.map((v) => v.dir || '.'), variants: info.variants });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
