// `ts-opt fit` engine (doc 05 §8.3): static pass + timed pass + verdict, per TS package. Read-only and run-less.
// runFit() never throws: any internal failure comes back as a result with a `notes` entry and verdict cannot-probe.
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ensureArtifactRoot } from '../artifacts/store.mjs';
import { catalogJson, loadRules } from '../catalog/index.mjs';
import { nowIso } from '../core/clock.mjs';
import { isFile, readJsonc, readText, toPosix } from '../core/fs.mjs';
import { listFiles, walkFiles } from '../core/files.mjs';
import { major } from '../core/semver.mjs';
import { packageOf } from '../detect/classify.mjs';
import { findPackage, whichSync } from '../detect/compilers.mjs';
import { IS_WIN } from '../core/proc.mjs';
import { runTells } from '../engines/tells.mjs';
import { evalDefaultExposure, evalPathsShape, evalRemoved, findBaseUrlImports, resolveChainOptions, topLevelNames } from './config-scan.mjs';
import { matchEcosystem, RUNNER_CONFIG_RE } from './ecosystem.mjs';
import { evalReferences, isCiFile, scanCiText, scanEditorSettings, staleBuildInfo } from './environment.mjs';
import { extractImports, listSourceFiles, readFiles } from './imports.mjs';
import { compilerArgv, declarationProbe, probeVersion, timedPass } from './probe.mjs';
import { parseLocated, prop } from './jsonloc.mjs';
import { packageVerdict, projectVerdict } from './verdict.mjs';

export const FIT_SCHEMA = 'ts-optimize/fit@1';
const MAX_LIST = 200;
const exe = (n) => (IS_WIN ? n + '.cmd' : n);
const cap = (list, n = MAX_LIST) => (list.length > n ? list.slice(0, n) : list);
const joinRel = (pkgPath, f) => (pkgPath === '.' || pkgPath === '' ? f : `${pkgPath}/${f}`);

/** where the package's own package.json declares `typescript` -> {file, line, field, range} | null (tc-12 edits exactly this line) */
function declaredTypescript(root, pkgPath) {
  const file = pkgPath === '.' ? 'package.json' : `${pkgPath}/package.json`;
  const text = readText(join(root, file));
  if (text === null) return null;
  try {
    const doc = parseLocated(text);
    for (const field of ['devDependencies', 'dependencies']) {
      const group = prop(doc, field);
      const dep = group && prop(group.node, 'typescript');
      if (dep) return { file, line: dep.line, field, range: String(dep.node.value ?? '') };
    }
  } catch { /* unparsable package.json: no tc-12 */ }
  return null;
}

function emptyResult(root, verdict, reason, notes = []) {
  return { schema: FIT_SCHEMA, generated: nowIso(), root, head: null, verdict, packages: [], ecosystem: [], ci: [], editor: [], references: null, cannot_probe_reason: reason, next_actions: [], notes };
}

function hasAtTypes(startDir, root) {
  let d = resolve(startDir); const stop = resolve(root);
  for (;;) {
    try { if (readdirSync(join(d, 'node_modules', '@types')).length) return true; } catch { /* none here */ }
    if (d === stop || dirname(d) === d) return false;
    d = dirname(d);
  }
}

async function resolveFast(pkg, home) {
  const c = pkg.compilers;
  if (c?.authoritative?.kind === 'native') return { kind: 'native', version: c.authoritative.version, bin: c.authoritative.bin, exec: c.authoritative.exec, source: c.authoritative.source };
  const cands = [];
  if (c?.fast) cands.push({ ...c.fast });
  const tb = join(home || '', 'toolbox-native', 'node_modules', '.bin', exe('tsc'));
  if (home && isFile(tb) && !cands.some((x) => x.bin === tb)) cands.push({ kind: 'native', version: null, bin: tb, source: 'toolbox' });
  for (const [name, source] of [['tsgo', 'path'], ['tsc', 'path']]) { const p = whichSync(name); if (p && !cands.some((x) => x.bin === p)) cands.push({ kind: 'native', version: null, bin: p, source }); }
  for (const cand of cands) {
    const v = await probeVersion([cand.bin]);
    if (v && (v.major >= 7 || /-dev|native-preview/.test(v.version) || cand.kind === 'native-preview')) return { ...cand, version: v.version };
  }
  return null;
}

function compilerLabel(auth) { return auth?.version ? `${auth.kind} ${auth.version}` : auth?.kind || 'none'; }

/**
 * runFit({root, detect, config, home}) -> fit result (schema ts-optimize/fit@1)
 */
export async function runFit({ root, detect: d, config = {}, home = null } = {}) {
  const t0 = Date.now();
  try {
    return await fitInner({ root, d, config, home, t0 });
  } catch (e) {
    return emptyResult(root, 'cannot-probe', `fit failed internally: ${String(e && e.message || e).slice(0, 300)}`, [`internal error: ${String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 500)}`]);
  }
}

async function fitInner({ root, d, config, home, t0 }) {
  if (!d || !d.typescript) return emptyResult(root, 'not-applicable', null, ['no TypeScript found']);
  const removedData = catalogJson('removed-options.json');
  const defaultsData = catalogJson('defaults-changes.json');
  const ecoData = catalogJson('ecosystem-compat.json');
  const notes = [];
  for (const [n, v] of [['removed-options.json', removedData], ['defaults-changes.json', defaultsData], ['ecosystem-compat.json', ecoData]]) if (!v) notes.push(`catalog/${n} is missing or unreadable: the matching checks were skipped`);
  const inGit = !!d.git?.repo;
  const capMs = (config?.gate?.timeout_s?.typecheck || 600) * 1000;
  const pkgs = d.packages.filter((p) => !p.root_only && p.kind !== 'deno' && p.tsconfigs?.length);
  const absOf = (p) => join(root, p.path === '.' ? '' : p.path);
  const relRoot = (abs) => toPosix(abs.startsWith(root) ? abs.slice(root.length + 1) : abs);

  // ---- reading ---------------------------------------------------------------------------------------------------
  const sourceFiles = await listSourceFiles(root, inGit);
  const sources = (await readFiles(root, sourceFiles)).map((s) => ({ ...s, package: packageOf(s.file, d.packages) }));
  const manifestPaths = new Set(d.packages.filter((p) => p.has_package_json).map((p) => joinRel(p.path, 'package.json')));
  if (isFile(join(root, 'package.json'))) manifestPaths.add('package.json');
  const manifests = [];
  for (const f of [...manifestPaths].sort()) {
    const text = readText(join(root, f));
    if (text !== null) manifests.push({ file: f, text, package: dirname(f) === '.' ? '.' : dirname(f) });
  }
  const extraRunner = await listFiles(root, ['.mocharc*', 'jest.config.*', 'webpack.config.*', 'nodemon.json', '.swcrc'], { inGit, maxDepth: 5 });
  const runnerNames = new Set([...sourceFiles.filter((f) => RUNNER_CONFIG_RE.test(f)), ...extraRunner.filter((f) => RUNNER_CONFIG_RE.test(f))]);
  const configs = (await readFiles(root, [...runnerNames].filter((f) => !/(^|\/)package\.json$/.test(f)))).map((s) => ({ ...s, package: packageOf(s.file, d.packages) }));
  const legs = new Set((d.gate?.legs || []).map((l) => l.id));
  if (d.lint?.engine || d.packages.some((p) => p.scripts?.lint)) legs.add('lint');
  const versionOf = (name, manifestFile) => !name ? null : findPackage(join(root, dirname(manifestFile) === '.' ? '' : dirname(manifestFile)), root, name)?.version || null;

  // ---- ecosystem (repo wide, attributed to the package that declares/imports) --------------------------------------
  const ecoHits = ecoData ? matchEcosystem({ manifests, sources, configs, data: ecoData, versionOf, legs }) : [];
  const ecosystem = ecoHits.map((h) => ({ ...h, evidence_count: h.evidence.length, evidence: cap(h.evidence, 12) }));

  // ---- CI / container / editor / references ---------------------------------------------------------------------
  const ciList = await listFiles(root, ['*.yml', '*.yaml', 'Dockerfile*', '*.dockerfile', 'Jenkinsfile', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'netlify.toml'], { inGit, maxDepth: 6 });
  const ciFiles = (await readFiles(root, ciList.filter(isCiFile)));
  const ci = [];
  for (const f of ciFiles) ci.push(...scanCiText(f.file, f.text));
  for (const m of manifests) ci.push(...scanCiText(m.file, m.text, { manifest: true }));
  const tracked = inGit ? (await listFiles(root, ['*.tsbuildinfo'], { inGit })).filter((f) => !f.split('/').includes('node_modules')) : [];
  let present = [];
  try { present = walkFiles(root, ['*.tsbuildinfo'], 5).map((f) => ({ file: f, mtimeMs: statSync(join(root, f)).mtimeMs })); } catch { /* best effort */ }
  let newestCfg = 0;
  for (const p of pkgs) for (const c of p.tsconfigs) { try { newestCfg = Math.max(newestCfg, statSync(join(absOf(p), c.file)).mtimeMs); } catch { /* gone */ } }
  ci.push(...staleBuildInfo({ tracked, present, configMtimeMs: newestCfg }));
  const ciOut = ci.map((x) => ({ rule: 'tc-06', ...x, package: packageOf(x.file, d.packages) }));

  const editor = [];
  const wsVersion = d.compilers?.authoritative?.version || null;
  for (const dir of new Set(['', ...pkgs.map((p) => (p.path === '.' ? '' : p.path))])) {
    const rel = joinRel(dir || '.', '.vscode/settings.json');
    const text = readText(join(root, rel));
    if (text === null) continue;
    const wsDir = join(root, dir);
    const tsdkInfo = (v) => {
      const abs = resolve(wsDir, v.replace(/^\$\{workspaceFolder\}\/?/, ''));
      if (!existsSync(abs)) return { exists: false };
      const pj = readJsonc(join(dirname(abs), 'package.json'));
      return { exists: true, version: pj.ok ? pj.value.version || null : null };
    };
    editor.push(...scanEditorSettings(rel, text, { tsdkInfo, workspaceVersion: wsVersion }).map((x) => ({ rule: 'tc-07', ...x, package: packageOf(x.file, d.packages) })));
  }
  const turboRead = readJsonc(join(root, 'turbo.json'));
  const references = evalReferences(d.packages, turboRead.ok ? turboRead.value : null);

  // ---- per package -------------------------------------------------------------------------------------------------
  const tc09 = loadRules().get('tc-09');
  const packagesOut = [];
  const pendingProbes = [];
  for (const p of pkgs) {
    const pkgDir = absOf(p);
    const comp = p.compilers || { authoritative: { kind: 'none' }, fast: null };
    const auth = comp.authoritative || { kind: 'none' };
    const authMajor = auth.version ? major(auth.version) : null;
    const out = {
      path: p.path, name: p.name,
      authoritative: { kind: auth.kind, version: auth.version || null, source: auth.source || null, bin: auth.bin || null },
      fast: null, ms: { auth: null, fast: null, fast_single: null }, speedup: null, diag_equal: null,
      only_authoritative: [], only_native: [], divergence: { by_category: {}, unexplained: 0 },
      removed_options: [], paths_issues: [], baseurl_imports: [], default_exposure: [], js_constructs: null, declaration: null,
      typecheck_set: p.typecheck_set, config_files: p.tsconfigs.map((c) => joinRel(p.path, c.file)), runs: [], blockers: [], notes: [], verdict: null,
      declares_typescript: declaredTypescript(root, p.path),
    };

    // static: resolved chains of every tsconfig in the package
    const seenRemoved = new Set(); const seenDefaults = new Map(); const seenPaths = new Set();
    let baseUrlOrigin = null; let pathsKeys = [];
    const atTypes = hasAtTypes(pkgDir, root);
    for (const c of p.tsconfigs) {
      const abs = join(pkgDir, c.file);
      const chain = resolveChainOptions(abs, root);
      if (chain.parse_error) { out.notes.push(`${joinRel(p.path, c.file)}: ${chain.parse_error}`); continue; }
      const cfgRel = joinRel(p.path, c.file);
      if (removedData) for (const h of evalRemoved(chain.options, removedData, relRoot)) {
        const k = `${h.entry}|${h.file}|${h.line}`;
        if (seenRemoved.has(k)) { out.removed_options.find((x) => `${x.entry}|${x.file}|${x.line}` === k).configs.push(cfgRel); continue; }
        seenRemoved.add(k); out.removed_options.push({ ...h, configs: [cfgRel] });
        if (h.entry === 'baseUrl' && !baseUrlOrigin) {
          const o = chain.options.get('baseurl');
          baseUrlOrigin = { dir: dirname(o.file), value: o.value };
        }
      }
      for (const h of evalPathsShape(chain.options, relRoot)) { const k = `${h.file}|${h.line}|${h.value}`; if (!seenPaths.has(k)) { seenPaths.add(k); out.paths_issues.push(h); } }
      const pathsOpt = chain.options.get('paths');
      if (pathsOpt && pathsOpt.node.type === 'object') pathsKeys = [...new Set([...pathsKeys, ...pathsOpt.node.props.keys()])];
      if (defaultsData && c.class !== 'tooling' && c.class !== 'base') for (const e of evalDefaultExposure(chain.options, defaultsData, { authMajor, atTypes, libReplacementPackages: false })) {
        const prev = seenDefaults.get(e.id);
        if (prev) prev.configs.push(cfgRel); else seenDefaults.set(e.id, { ...e, configs: [cfgRel] });
      }
    }
    out.default_exposure = [...seenDefaults.values()];

    // tc-02: imports that resolve only through baseUrl
    if (baseUrlOrigin) {
      const names = topLevelNames(resolve(baseUrlOrigin.dir, String(baseUrlOrigin.value)));
      const declared = new Set(p.deps || []);
      const pkgSources = sources.filter((s) => s.package === p.path && /\.[cm]?[jt]sx?$/.test(s.file));
      const isInstalled = (n) => declared.has(n) || !!findPackage(pkgDir, root, n) || !!findPackage(pkgDir, root, `@types/${n}`);
      out.baseurl_imports = findBaseUrlImports({ sources: pkgSources, names, isInstalled, aliasKeys: pathsKeys });
    }

    // tc-09: JS constructs in packages that check JavaScript
    const allowJs = p.tsconfigs.some((c) => c.signals?.allowJs === true) || p.signals?.allowJs === true;
    if (allowJs && tc09) {
      const jsFiles = sourceFiles.filter((f) => packageOf(f, d.packages) === p.path && /\.[cm]?jsx?$/.test(f));
      const t = await runTells({ root, files: jsFiles, rules: [tc09], packages: d.packages });
      const byTell = {};
      for (const c of t.candidates) for (const id of c.tells || []) byTell[id] = (byTell[id] || 0) + 1;
      out.js_constructs = { files: jsFiles.length, hits: t.candidates.length, by_tell: byTell, examples: t.candidates.slice(0, 10).map((c) => ({ file: c.file, line: c.line, tells: c.tells })) };
    }

    // compilers for the timed pass
    const fast = await resolveFast(p, home);
    out.fast = fast ? { kind: fast.kind, version: fast.version || null, source: fast.source || null, bin: fast.bin || null } : null;
    pendingProbes.push({ p, out, auth, fast, pkgDir });
    packagesOut.push(out);
  }

  // ---- timed pass (sequential: concurrent runs would distort every timing) -----------------------------------------
  const prefixes = [root];
  for (const { p, out, auth, fast, pkgDir } of pendingProbes) {
    const authPrefix = compilerArgv(auth);
    const native = auth.kind === 'native';
    const fastPrefix = compilerArgv(fast);
    let reason = null;
    if (!authPrefix) reason = auth.kind === 'none' ? `no TypeScript compiler found for ${p.path}` : `the authoritative compiler for ${p.path} cannot be run directly`;
    else if (!native && !fastPrefix) reason = 'no native compiler available (no project tsgo / TypeScript 7, toolbox typescript-native not installed, none on PATH)';
    out.canProbe = !reason;
    if (reason) { out.probe = { status: 'skipped', reason }; out.notes.push(`timed pass skipped: ${reason}`); continue; }
    const set = (p.typecheck_set || []).length ? p.typecheck_set : [{ variant: 'tsc', config: 'tsconfig.json' }];
    let scratchN = 0;
    const scratchFor = (entry) => {
      if (!out.removed_options.length || !removedData) return null;
      try {
        ensureArtifactRoot(root);
        const dir = join(root, '.ts-optimize', 'fit', 'scratch', `${p.path === '.' ? 'root' : p.path.replace(/[^\w.-]+/g, '_')}-${scratchN++}`);
        const cfgAbs = resolve(pkgDir, entry.config || 'tsconfig.json');
        const overrides = {};
        for (const r of out.removed_options) {
          const e = removedData.entries.find((x) => x.id === r.entry);
          overrides[r.option] = e && 'scratch_override' in e ? e.scratch_override : null;
        }
        if (!resolveChainOptions(cfgAbs, root).options.has('rootdir')) overrides.rootDir = toPosix(relative(dir, dirname(cfgAbs))) || '.';
        mkdirSync(dir, { recursive: true });
        let ext = toPosix(relative(dir, cfgAbs));
        if (!ext.startsWith('.')) ext = './' + ext;
        writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: ext, compilerOptions: overrides }, null, 2) + '\n');
        return { config: toPosix(relative(pkgDir, join(dir, 'tsconfig.json'))), overrides, cleanup: () => { rmSync(dir, { recursive: true, force: true }); try { rmdirSync(dirname(dir)); } catch { /* other scratch dirs still in use or already gone */ } } };
      } catch { return null; }
    };
    const t = await timedPass({ pkgDir, relPath: p.path, set, auth: { argv: authPrefix, native }, fast: fastPrefix ? { argv: fastPrefix } : null, capMs, prefixes: [...prefixes, pkgDir], defaults: out.default_exposure.filter((e) => e.effective), scratchFor });
    out.probe = { status: t.ran ? 'ran' : 'skipped', reason: t.ran ? null : t.notes[0] || null };
    out.ms = t.ms; out.native_config = t.scratch?.used ? 'scratch' : 'project'; if (t.scratch) out.scratch = { overrides: t.scratch.overrides, unmodified_ms: t.scratch.unmodified_ms }; out.diag_equal = t.diag_equal; out.divergence = t.divergence;
    out.only_authoritative = cap(t.only_authoritative); out.only_native = cap(t.only_native);
    if (t.only_native.length > MAX_LIST || t.only_authoritative.length > MAX_LIST) out.notes.push(`diagnostic lists truncated to ${MAX_LIST} items`);
    out.runs = [...(t.auth?.entries || []).map((e) => ({ side: 'authoritative', ...e })), ...(t.fast && !native ? t.fast.entries.map((e) => ({ side: 'native', ...e })) : []), ...(t.fast_single ? t.fast_single.entries.map((e) => ({ side: 'native-single-threaded', ...e })) : [])];
    out.nativeFailed = !!(t.fast && !native && (t.fast.crashed || t.fast.timedOut));
    out.notes.push(...t.notes, ...t.skipped.map((s) => `skipped ${s.config || ''}: ${s.reason}`));
    const A = out.ms.auth; const F = out.ms.fast; const S = out.ms.fast_single;
    out.speedup = !native && A > 0 && F > 0 && !out.nativeFailed ? { fast_vs_auth: Math.round((A / F) * 100) / 100, comparable: null, basis: 'wall time on this machine, best of two passes when a pass takes under 20 s, one pass otherwise' } : null;
    if (F > 0 && S > 0) out.parallel = { single_vs_default: Math.round((S / F) * 100) / 100, basis: 'native --singleThreaded wall time divided by native default wall time' };
    if (!native && out.fast && p.declaration_signal && out.probe.status === 'ran') {
      const cfg = (set.find((e) => e.variant === 'tsc') || {}).config;
      if (cfg) out.declaration = await declarationProbe({ pkgDir, relPath: p.path, config: cfg, auth: { argv: authPrefix }, fast: { argv: fastPrefix }, capMs, prefixes: [...prefixes, pkgDir] });
      else out.declaration = { checked: false, reason: 'solution configuration: declaration-only emit with --outDir is not allowed with -b (TS5065)' };
    }
  }

  // ---- attribute, blockers, verdicts -------------------------------------------------------------------------------
  const ecoByPkg = new Map();
  for (const h of ecosystem) ecoByPkg.set(h.package, [...(ecoByPkg.get(h.package) || []), h]);
  for (const out of packagesOut) {
    const p = pendingProbes.find((x) => x.out === out).p;
    // knock-on of baseUrl removal: TS2307/TS2792 on an import that only resolved through baseUrl is tc-02, not unexplained
    for (const list of [out.only_native, out.only_authoritative]) for (const dgn of list) {
      if (dgn.category !== 'unexplained' && dgn.category !== 'wording') continue;
      if (['TS2307', 'TS2792', 'TS2688'].includes(dgn.code) && out.baseurl_imports.some((b) => b.file === dgn.file && dgn.message.includes(`'${b.spec}'`))) { dgn.category = 'baseurl-import'; dgn.rule = 'tc-02'; dgn.detail = 'import resolved only through the removed baseUrl'; }
    }
    // a TypeScript file that consumes a JavaScript file whose JSDoc/JS semantics differ inherits its diagnostics (tc-09 knock-on)
    const jsDeltaFiles = new Set([...out.only_native, ...out.only_authoritative].filter((x) => x.category === 'jsdoc').map((x) => x.file.replace(/\.[cm]?jsx?$/, '')));
    if (jsDeltaFiles.size) {
      for (const dgn of [...out.only_native, ...out.only_authoritative]) {
        if (dgn.category !== 'unexplained') continue;
        const src = sources.find((s) => s.file === dgn.file);
        if (!src) continue;
        const dir = dirname(dgn.file);
        const hit = extractImports(src.text).some((imp) => imp.spec.startsWith('.') && jsDeltaFiles.has(toPosix(join(dir, imp.spec)).replace(/^\.\//, '').replace(/\.[cm]?jsx?$/, '')));
        if (hit) { dgn.category = 'jsdoc'; dgn.rule = 'tc-09'; dgn.detail = 'consumes a JavaScript file whose JSDoc/JS semantics differ in the native compiler'; }
      }
    }
    const by = {}; let unexplained = 0;
    for (const dgn of [...out.only_native, ...out.only_authoritative]) { by[dgn.category] = (by[dgn.category] || 0) + dgn.count; if (dgn.category === 'unexplained') unexplained += dgn.count; }
    out.divergence = { by_category: by, unexplained };
    if (out.speedup) out.speedup.comparable = out.diag_equal === true || (out.native_config === 'scratch' && unexplained === 0);
    // default-change attribution: native-only diagnostics explained by a flipped default
    for (const e of out.default_exposure) e.attributed = out.only_native.filter((x) => x.category === 'default-change' && x.default === e.id).map((x) => ({ code: x.code, file: x.file, line: x.line, message: x.message, count: x.count }));
    const attributed = out.default_exposure.filter((e) => e.attributed.length);

    const B = out.blockers;
    for (const r of out.removed_options) for (const rule of r.rules) B.push({ rule, detail: `${r.option}${r.value === true || r.value === false || typeof r.value === 'string' ? ': ' + JSON.stringify(r.value) : ''} (${r.code || 'removed'}): ${r.remedy ? (r.remedy.length > 150 ? r.remedy.slice(0, 147) + '...' : r.remedy) : 'remove or replace'}`, file: r.file, line: r.line });
    for (const r of out.paths_issues) B.push({ rule: 'tc-02', detail: `paths value "${r.value}" for "${r.key}" is not tsconfig-relative`, file: r.file, line: r.line });
    for (const r of out.baseurl_imports) B.push({ rule: 'tc-02', detail: `import "${r.spec}" resolves only through baseUrl`, file: r.file, line: r.line });
    for (const e of attributed) B.push({ rule: 'tc-03', detail: `${e.option} default changed (${e.flipped_in}): ${e.attributed.reduce((n, x) => n + x.count, 0)} native-only diagnostic(s), e.g. ${e.attributed[0].code}`, file: e.attributed[0].file, line: e.attributed[0].line });
    const jsFiles = new Map();
    for (const dgn of [...out.only_native, ...out.only_authoritative]) if (dgn.category === 'jsdoc' && !jsFiles.has(dgn.file)) jsFiles.set(dgn.file, dgn);
    for (const [file, dgn] of jsFiles) B.push({ rule: 'tc-09', detail: `${dgn.code} ${dgn.message.slice(0, 110)} (flag-only: rewrite the JSDoc/JS construct)`, file, line: dgn.line || 1 });
    const eco = (ecoByPkg.get(out.path) || []).filter((h) => h.broken && h.rule);
    for (const h of eco) B.push({ rule: h.rule, detail: `${h.tool}: ${h.status_text}`, file: h.evidence[0]?.file, line: h.evidence[0]?.line });
    if (out.divergence.unexplained) B.push({ rule: 'tc-11', detail: `${out.divergence.unexplained} diagnostic(s) differ between the compilers and no known divergence explains them` });

    const native = out.authoritative.kind === 'native';
    const configIssues = out.removed_options.length + out.paths_issues.length + out.baseurl_imports.length + attributed.length + jsFiles.size;
    out.verdict = packageVerdict({ applicable: true, native, canProbe: native || out.canProbe !== false, nativeFailed: !!out.nativeFailed, configIssues, unexplained: out.divergence.unexplained, bridgeNeeded: (ecoByPkg.get(out.path) || []).some((h) => h.broken) });
    delete out.canProbe; delete out.nativeFailed;
    void p;
  }
  // packages without a TS-checkable setup
  for (const p of d.packages.filter((x) => x.kind === 'deno')) packagesOut.push({ path: p.path, name: p.name, verdict: 'not-applicable', authoritative: null, fast: null, notes: ['Deno project: deno check is the type checker'], blockers: [], removed_options: [] });
  packagesOut.sort((a, b) => a.path.localeCompare(b.path));

  const verdict = projectVerdict(packagesOut.map((x) => x.verdict));
  const cannot = packagesOut.filter((x) => x.verdict === 'cannot-probe');
  const cannot_probe_reason = verdict === 'cannot-probe' ? [...new Set(cannot.map((x) => x.probe?.reason).filter(Boolean))].join('; ') || 'no native compiler available' : null;
  const next_actions = nextActions(verdict, { cannot_probe_reason, packages: packagesOut, ecosystem, ci: ciOut });
  return {
    schema: FIT_SCHEMA, generated: nowIso(), root, head: d.git?.head ?? null, dirty: d.git?.clean === false, verdict,
    packages: packagesOut, ecosystem, ci: ciOut, editor, references, cannot_probe_reason, next_actions, notes,
    data: { removed_options: removedData?.checked_on || null, defaults_changes: defaultsData?.checked_on || null, ecosystem_compat: ecoData?.checked_on || null },
    elapsed_ms: Date.now() - t0, compilers: Object.fromEntries(packagesOut.filter((x) => x.authoritative).map((x) => [x.path, { authoritative: compilerLabel(x.authoritative), fast: x.fast ? compilerLabel(x.fast) : null }])),
  };
}

function nextActions(verdict, { cannot_probe_reason, packages, ecosystem, ci }) {
  const hasFindings = packages.some((p) => (p.blockers || []).length) || ecosystem.some((e) => e.rule) || ci.length;
  if (verdict === 'cannot-probe') return [{ cmd: 'ts-opt toolbox install --native --yes', why: `${cannot_probe_reason}. With your consent this installs the pinned native compiler (typescript@7) into the plugin data directory, never into your project; then re-run ts-opt fit. Alternative: install typescript@next in a scratch branch.` }];
  if (verdict === 'not-applicable') return [];
  if (verdict === 'already-native' && !hasFindings) return [];
  return [{ cmd: 'ts-opt scan --mode tsgo', why: 'turn the fit result into reviewable findings (rules tc-01…tc-11, waves T1-T4); nothing in the project changes until you approve a plan' }];
}

export { basename };
