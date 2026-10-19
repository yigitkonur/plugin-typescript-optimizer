// TS packages: which directories are TypeScript projects, their tsconfig graph, typecheck set and scripts (doc 05 §2).
import { dirname, join, resolve } from 'node:path';
import { isFile, readJsonc, toPosix } from '../core/fs.mjs';
import { dirOf } from './manifests.mjs';
import { classify, readTsconfig, signalsOf } from './tsconfig.mjs';

const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types', 'tsc', 'check'];
const OTHER_CHECKERS = [
  [/\bvue-tsc\b/, 'vue-tsc'], [/\bsvelte-check\b/, 'svelte-check'], [/\bastro\s+check\b/, 'astro check'],
  [/\bng\s+build\b|\bngc\b/, 'ng build'], [/\bnext\s+build\b/, 'next build'], [/\bnuxi?\s+typecheck\b/, 'nuxi typecheck'],
  [/\bdeno\s+check\b/, 'deno check'],
];
const depsOf = (pkg) => ({ ...(pkg?.peerDependencies || {}), ...(pkg?.optionalDependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.dependencies || {}) });

/** `tsc -p x.json`, `tsc --project x`, `tsc -b a b` -> [paths] */
export function tscConfigArgs(script) {
  const out = [];
  if (!/\btsc\b/.test(script)) return out;
  const re = /\btsc\b([^&|;]*)/g;
  let m;
  while ((m = re.exec(script))) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      if (['-p', '--project'].includes(toks[i]) && toks[i + 1]) out.push({ path: toks[++i], build: false });
      else if (['-b', '--build'].includes(toks[i])) { while (toks[i + 1] && !toks[i + 1].startsWith('-')) out.push({ path: toks[++i], build: true }); if (!out.some((o) => o.build)) out.push({ path: '.', build: true }); }
    }
  }
  return out;
}

function cfgFileFor(dir, p) {
  const abs = resolve(dir, p);
  return [abs, abs + '.json', join(abs, 'tsconfig.json')].find(isFile) || null;
}

function typecheckSet(root, dir, configs, scripts) {
  const set = []; const seen = new Set();
  const push = (e) => { const k = `${e.variant}:${e.config || e.script}`; if (!seen.has(k)) { seen.add(k); set.push(e); } };
  const relCfg = (f) => toPosix(f.slice(dir.length + 1));
  // 5b: a script that runs a different checker is the authority for this package (doc 05 §2). `next build` / `ng build`
  // inside the build script are covered by the build leg, so they do not become a second typecheck leg.
  let scriptAuthority = false;
  for (const name of TYPECHECK_SCRIPTS) {
    const text = scripts[name];
    if (!text) continue;
    const hit = OTHER_CHECKERS.find(([re]) => re.test(text));
    if (hit) { push({ variant: 'script', script: name, checker: hit[1] }); scriptAuthority = true; break; }
  }
  const hasTscScript = TYPECHECK_SCRIPTS.concat(['build']).some((n) => /\btsc\b/.test(scripts[n] || ''));
  if (scriptAuthority && !hasTscScript) return set;
  const solution = configs.find((c) => c.class === 'solution');
  const named = [];
  for (const name of TYPECHECK_SCRIPTS.concat(['build'])) for (const a of tscConfigArgs(scripts[name] || '')) {
    const f = cfgFileFor(dir, a.path); if (f) named.push({ f, build: a.build });
  }
  if (solution) push({ variant: 'tsc-b', config: relCfg(solution.file) });
  else if (named.length) for (const n of named) push({ variant: n.build ? 'tsc-b' : 'tsc', config: relCfg(n.f) });
  else {
    const dflt = configs.find((c) => c.file === join(dir, 'tsconfig.json')) || configs.find((c) => c.class === 'project');
    if (dflt) push({ variant: dflt.cfg.references.length ? 'tsc-b' : 'tsc', config: relCfg(dflt.file) });
  }
  // test/spec configs and project configs with a distinct include set
  const includeKey = (c) => JSON.stringify([c.cfg.include ?? null, c.cfg.files ?? null]);
  const covered = new Set(set.map((e) => e.config));
  const coveredIncludes = new Set(configs.filter((c) => covered.has(relCfg(c.file))).map(includeKey));
  if (!solution) for (const c of configs) {
    if (c.class !== 'project' || covered.has(relCfg(c.file))) continue;
    const n = relCfg(c.file);
    if (/^tsconfig\.(test|spec)\.json$/.test(n) || !coveredIncludes.has(includeKey(c))) { push({ variant: 'tsc', config: n }); coveredIncludes.add(includeKey(c)); }
  }
  return set;
}

function analyzePackage(root, relDir, pkg, manifests) {
  const dir = relDir === '' ? root : join(root, relDir);
  const cfgFiles = manifests.tsconfigs.filter((f) => dirOf(f) === relDir).map((f) => join(root, f));
  const configs = cfgFiles.map((file) => ({ file, cfg: readTsconfig(file, { stopAt: root }) }));
  const classified = classify(configs, dir).map((c) => ({
    file: toPosix(c.file.slice(dir.length + 1)), abs: c.file, class: c.class, signals: signalsOf(c.cfg.options), include: c.cfg.include ?? null, files: c.cfg.files ?? null,
    references: c.cfg.references, extends: c.cfg.extends || [], unresolved_extends: c.cfg.unresolved_extends.map((u) => u.spec), parse_error: c.cfg.parse_error,
    cfg: c.cfg, file_abs: c.file,
  }));
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const forSet = classified.map((c) => ({ file: c.file_abs, class: c.class, cfg: c.cfg }));
  const typecheck_set = typecheckSet(root, dir, forSet, scripts);
  const primary = classified.find((c) => c.file === 'tsconfig.json') || classified.find((c) => c.class === 'project') || classified[0] || null;
  const sig = primary ? primary.signals : null;
  const anyDecl = classified.some((c) => ['declaration', 'composite', 'isolatedDeclarations', 'emitDeclarationOnly'].some((k) => c.signals[k] === true));
  const distTarget = (v) => typeof v === 'string' && /(^|\/)dist\//.test(v);
  const exportsStr = JSON.stringify(pkg?.exports ?? null);
  const declaration_signal = anyDecl || !!(pkg && (pkg.types || pkg.typings || /"types"\s*:/.test(exportsStr) || distTarget(pkg.main) || distTarget(pkg.module) || /\bdist\//.test(exportsStr)));
  return {
    path: relDir === '' ? '.' : relDir,
    name: pkg?.name ?? null,
    private: !!pkg?.private,
    has_package_json: !!pkg,
    kind: 'node',
    tsconfigs: classified.map(({ cfg, file_abs, abs, ...rest }) => rest),
    typecheck_set,
    declaration_signal,
    signals: sig,
    scripts: Object.fromEntries(['test', 'build', 'lint', ...TYPECHECK_SCRIPTS].filter((k) => scripts[k]).map((k) => [k, scripts[k]])),
    deps: pkg ? Object.keys(depsOf(pkg)) : [],
    workspace_deps: [],
  };
}

/**
 * -> { rootPkg, packages:[...], unavailable_reason }
 * Candidates: workspace members + root when workspaces exist; otherwise package.json dirs (depth <= 2) or tsconfig dirs.
 */
export function buildPackages(root, manifests, ws) {
  const pkgJsonByDir = new Map();
  for (const f of manifests.packageJsons) {
    const r = readJsonc(join(root, f));
    if (r.ok && r.value && typeof r.value === 'object') pkgJsonByDir.set(dirOf(f), r.value);
  }
  const rootPkg = pkgJsonByDir.get('') || null;
  let candidates;
  if (ws.members.length) candidates = ['', ...ws.members];
  else {
    const pk = [...pkgJsonByDir.keys()].filter((d) => d.split('/').length <= 2 || d === '');
    const tsOnly = [...new Set(manifests.tsconfigs.map(dirOf))].filter((d) => !pkgJsonByDir.has(d) && (d === '' || d.split('/').length <= 2));
    candidates = [...new Set([...pk, ...tsOnly])];
  }
  const packages = [];
  for (const d of [...new Set(candidates)].sort()) {
    const pkg = pkgJsonByDir.get(d) || null;
    const hasCfg = manifests.tsconfigs.some((f) => dirOf(f) === d);
    const tsDep = pkg && (depsOf(pkg).typescript || pkg.types || pkg.typings);
    if (!hasCfg && !tsDep) continue;
    packages.push(analyzePackage(root, d, pkg, manifests));
  }
  // internal dependency edges for topological order
  const names = new Map(packages.filter((p) => p.name).map((p) => [p.name, p.path]));
  for (const p of packages) p.workspace_deps = p.deps.filter((n) => names.has(n)).map((n) => names.get(n)).filter((x) => x !== p.path);
  // the root of a workspace repo that only orchestrates (typescript devDep, no tsconfig) is not a TS package of its own
  const isOrchestratorRoot = (p) => p.path === '.' && ws.members.length > 0 && p.tsconfigs.length === 0;
  for (const p of packages) { p.root_only = isOrchestratorRoot(p); p.workspace_root = p.path === '.' && ws.members.length > 0; }
  // Deno projects: `deno check` is the typecheck, Node-based engines are skipped (doc 05 §2 5b)
  for (const f of manifests.markers.filter((m) => /(^|\/)deno\.jsonc?$/.test(m))) {
    const d = dirOf(f);
    if (packages.some((p) => p.path === (d || '.') && p.tsconfigs.length)) continue;
    const dj = readJsonc(join(root, f));
    const tasks = dj.ok && dj.value && typeof dj.value.tasks === 'object' ? dj.value.tasks : {};
    const checkTask = ['check', 'typecheck', 'type-check'].find((t) => tasks[t]);
    packages.push({
      path: d || '.', name: dj.ok ? dj.value.name ?? null : null, private: false, has_package_json: false, kind: 'deno', tsconfigs: [],
      typecheck_set: [checkTask ? { variant: 'script', script: checkTask, checker: 'deno task', argv: ['deno', 'task', checkTask] } : { variant: 'deno', checker: 'deno check', argv: ['deno', 'check', '.'] }],
      declaration_signal: false, signals: null, scripts: Object.fromEntries(['test', 'build', 'lint', 'check'].filter((k) => tasks[k]).map((k) => [k, tasks[k]])),
      workspace_deps: [], root_only: false, workspace_root: false, deps: [],
    });
  }
  return { rootPkg, packages, pkgJsonByDir };
}

export function topoOrder(packages) {
  const byPath = new Map(packages.map((p) => [p.path, p]));
  const out = []; const state = new Map();
  const visit = (p) => {
    if (state.get(p.path) === 2) return;
    if (state.get(p.path) === 1) return; // cycle: keep going, order is best effort
    state.set(p.path, 1);
    for (const d of p.workspace_deps) { const q = byPath.get(d); if (q) visit(q); }
    state.set(p.path, 2); out.push(p);
  };
  for (const p of [...packages].sort((a, b) => a.path.localeCompare(b.path))) visit(p);
  return out;
}

export { depsOf, dirname };
