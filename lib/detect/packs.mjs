// Pack data + workerd analysis (doc 05 s6, doc 03 s4). Facts are read from wrangler configs, never guessed.
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { readText, readJsonc, isFile } from '../core/fs.mjs';
import { walkFiles } from '../core/files.mjs';
import { matchGlob } from '../core/glob.mjs';
import { tryParseJsonc } from '../core/jsonc.mjs';
import { tryParseToml } from '../core/toml-min.mjs';
import { dirOf } from './manifests.mjs';

let cache = null;
/** -> { frameworks: {packs:{name:{...}}}, workerd } (cached) */
export function loadPacks() {
  if (cache) return cache;
  const rd = (n) => JSON.parse(readFileSync(new URL(`../../catalog/packs/${n}`, import.meta.url), 'utf8'));
  cache = { frameworks: rd('frameworks.json'), workerd: rd('workerd.json') };
  return cache;
}

const CODE_SPECS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs'];
const asArr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : null);

function readWrangler(abs) {
  const t = readText(abs);
  if (t === null) return null;
  const r = abs.endsWith('.toml') ? tryParseToml(t) : tryParseJsonc(t);
  return r.ok && r.value && typeof r.value === 'object' ? r.value : null;
}

/** Doc 05 s6 process_env_populated. -> { node_compat, process_env_populated: true|false|'unknown', reason } */
export function processEnvPopulated(cfg, wk = loadPacks().workerd.process_env) {
  if (!cfg) return { node_compat: false, process_env_populated: 'unknown', reason: 'no readable wrangler config' };
  const date = str(cfg.compatibility_date) && /^\d{4}-\d{2}-\d{2}$/.test(cfg.compatibility_date) ? cfg.compatibility_date : null;
  const flags = asArr(cfg.compatibility_flags).filter((f) => typeof f === 'string');
  const has = (f) => flags.includes(f);
  const nodeOn = (has(wk.node_compat_flag) || (date !== null && date >= wk.node_compat_default_date)) && !wk.node_compat_disable_flags.some(has);
  if (!nodeOn) return { node_compat: false, process_env_populated: false, reason: 'Node compatibility not effective (no nodejs_compat flag and compatibility_date < ' + wk.node_compat_default_date + ')' };
  if (has(wk.populate_opt_out_flag)) return { node_compat: true, process_env_populated: false, reason: `opt-out flag ${wk.populate_opt_out_flag}` };
  const odd = flags.find((f) => f !== wk.populate_flag && /process_env/.test(f) && /(^|_)(not|no)(_|$)/.test(f));
  if (odd) return { node_compat: true, process_env_populated: 'unknown', reason: `unrecognised process_env flag ${odd}` };
  if (has(wk.populate_flag)) return { node_compat: true, process_env_populated: true, reason: `flag ${wk.populate_flag}` };
  if (date !== null && date >= wk.populate_default_date) return { node_compat: true, process_env_populated: true, reason: `compatibility_date ${date} >= ${wk.populate_default_date}` };
  return { node_compat: true, process_env_populated: false, reason: 'compatibility_date < ' + wk.populate_default_date + ' and no ' + wk.populate_flag };
}

function findClassFile(root, scanDir, name) {
  const re = new RegExp(`\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?class\\s+${name.replace(/[^\w$]/g, '')}\\b`);
  for (const rel of walkFiles(join(root, scanDir), CODE_SPECS, 8)) {
    if (rel.endsWith('.d.ts')) continue;
    const t = readText(join(root, scanDir, rel));
    if (t !== null && re.test(t)) return posix.join(scanDir === '.' ? '' : scanDir, rel);
  }
  return null;
}

function ambientFor(root, dir, wk) {
  const out = new Set();
  for (const n of wk.ambient_files) if (isFile(join(root, dir, n))) out.add(posix.join(dir === '.' ? '' : dir, n));
  const ts = readJsonc(join(root, dir, 'tsconfig.json'));
  if (ts.ok && ts.value) for (const k of ['include', 'files']) for (const p of asArr(ts.value[k])) {
    if (typeof p === 'string' && p.endsWith('.d.ts') && !/[*?{]/.test(p) && isFile(join(root, dir, p))) out.add(posix.normalize(posix.join(dir === '.' ? '' : dir, p)));
  }
  return [...out].sort();
}

/** @returns {{active:boolean, variants:object[]}} */
export function workerdInfo(root, manifests, packages = []) {
  const wk = loadPacks().workerd;
  const dirs = new Map(); // dir -> wrangler file (first by priority jsonc, json, toml)
  const rank = (f) => ['.jsonc', '.json', '.toml'].findIndex((e) => f.endsWith(e));
  for (const f of [...manifests.wrangler].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const d = dirOf(f) || '.';
    if (!dirs.has(d)) dirs.set(d, f);
  }
  const depDirs = asArr(packages).filter((p) => asArr(p.deps).some((d) => wk.detect.deps.includes(d))).map((p) => p.path || '.');
  for (const d of depDirs) if (!dirs.has(d)) dirs.set(d, null);
  const variants = [];
  for (const [dir, file] of [...dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cfg = file ? readWrangler(join(root, file)) : null;
    const pe = processEnvPopulated(cfg, wk.process_env);
    const main = cfg ? str(cfg.main) : null;
    const mainRel = main ? posix.normalize(posix.join(dir === '.' ? '' : dir, main.replace(/^\.\//, ''))) : null;
    const scanDir = mainRel ? posix.dirname(mainRel) : dir;
    const classes = [];
    if (cfg) {
      const add = (n, kind) => { if (typeof n === 'string' && n && !classes.some((c) => c.class_name === n && c.kind === kind)) classes.push({ class_name: n, kind }); };
      const dobj = cfg.durable_objects && cfg.durable_objects.bindings;
      for (const b of asArr(dobj)) if (b && !b.script_name) add(b.class_name, 'durable_object');
      for (const w of asArr(cfg.workflows)) if (w && !w.script_name) add(w.class_name, 'workflow');
      for (const s of asArr(cfg.services)) if (s && typeof s.entrypoint === 'string') add(s.entrypoint, 'worker_entrypoint');
    }
    const rpc = classes.map((c) => ({ ...c, file: findClassFile(root, scanDir, c.class_name) }));
    variants.push({
      dir, wrangler_file: file, main: mainRel,
      compatibility_date: cfg && str(cfg.compatibility_date) ? cfg.compatibility_date : null,
      compatibility_flags: cfg ? asArr(cfg.compatibility_flags).filter((f) => typeof f === 'string') : [],
      node_compat: pe.node_compat, process_env_populated: pe.process_env_populated, populated_reason: pe.reason,
      rpc_classes: rpc, entry_files: mainRel ? [mainRel] : [], ambient_files: ambientFor(root, dir, wk),
    });
  }
  return { active: variants.length > 0, variants };
}

const fwNames = (frameworks) => asArr(frameworks).map((f) => (typeof f === 'string' ? f : f && f.name)).filter(Boolean);

export function frameworkEntryGlobs(frameworks) {
  const { packs } = loadPacks().frameworks;
  const out = { entry: [], route_like: [], protected: [], config_deps: [], special_exports: {} };
  const seen = { entry: new Set(), route_like: new Set(), protected: new Set(), config_deps: new Set() };
  const push = (k, list) => { for (const g of list) if (!seen[k].has(g)) { seen[k].add(g); out[k].push(g); } };
  for (const n of fwNames(frameworks)) {
    const p = Object.hasOwn(packs, n) ? packs[n] : null;
    if (!p) continue;
    push('entry', p.entry_globs); push('route_like', p.route_like_globs); push('protected', p.protected_globs); push('config_deps', p.config_referenced_deps);
    for (const [g, names] of Object.entries(p.special_exports)) out.special_exports[g] = [...new Set([...(out.special_exports[g] || []), ...names])];
  }
  return out;
}

export function routeLike(pathRel, frameworks) {
  if (typeof pathRel !== 'string') return false;
  const p = pathRel.replace(/\\/g, '/').replace(/^\.\//, '');
  return frameworkEntryGlobs(frameworks).route_like.some((g) => matchGlob(g, p) || matchGlob('**/' + g, p));
}

function manifestTargets(pkg) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const k of ['main', 'module', 'types', 'typings', 'exports', 'bin']) if (pkg[k] !== undefined) walk(pkg[k]);
  return [...out].filter((t) => t.startsWith('.') && !/[*]/.test(t.replace(/\*/g, '*')) || t.includes('*'));
}

/** dist/foo.js -> src/foo.{ts,tsx,mts,cts,js}; src paths pass through. */
export function mapToSource(target) {
  const t = posix.normalize(target.replace(/^\.\//, ''));
  const m = /^(?:dist|build|lib|out)\/(.*?)(\.d\.[cm]?ts|\.[cm]?js)?$/.exec(t);
  const base = m ? `src/${m[1]}` : t.replace(/(\.d\.[cm]?ts|\.[cm]?[jt]sx?)$/, '');
  return m || /\.(d\.[cm]?ts|[cm]?[jt]sx?)$/.test(t) ? `${base}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` : t;
}

/** Doc 03 s4 protected path globs (repo-relative, posix). `detect` = the detect() result. */
export function protectedPaths(root, detect) {
  const out = new Set();
  const pkgs = asArr(detect && detect.packages).length ? detect.packages : [{ path: '.' }];
  const fw = frameworkEntryGlobs(asArr(detect && detect.frameworks));
  const wk = loadPacks().workerd;
  const pre = (dir, g) => (dir === '.' || dir === '' ? g : `${dir}/${g}`);
  for (const p of pkgs) {
    const dir = p.path || '.';
    for (const g of ['tsconfig*.json', 'jsconfig.json', 'wrangler.json', 'wrangler.jsonc', 'wrangler.toml']) out.add(pre(dir, g));
    for (const g of [...fw.entry, ...fw.protected]) out.add(pre(dir, g));
    const pj = readJsonc(join(root, dir, 'package.json'));
    if (pj.ok && pj.value && typeof pj.value === 'object') {
      for (const t of manifestTargets(pj.value)) { if (/^\.\.|^\/|\.json$|\.css$/.test(t)) continue; out.add(pre(dir, mapToSource(t))); if (!/^\.?\/?(dist|build|lib|out)\//.test(t)) out.add(pre(dir, posix.normalize(t.replace(/^\.\//, '')))); }
    }
    for (const rel of walkFiles(join(root, dir), ['*.d.ts'], 6)) {
      const t = readText(join(root, dir, rel));
      if (t !== null && !/^\s*(import|export)\b/m.test(t)) out.add(pre(dir, rel));
    }
  }
  const wi = workerdInfo(root, detect && detect.__manifests ? detect.__manifests : { wrangler: [] }, []);
  const packs = asArr(detect && detect.packs).find((x) => x.name === 'workerd');
  if (packs) {
    for (const d of packs.paths) { const v = workerdInfo(root, { wrangler: ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].map((n) => (d === '.' ? n : `${d}/${n}`)).filter((f) => isFile(join(root, f))) }, []); wi.variants.push(...v.variants); }
    for (const g of wk.protected_globs) out.add(g);
  }
  for (const v of wi.variants) {
    for (const f of [...v.entry_files, ...v.ambient_files]) out.add(f);
    for (const c of v.rpc_classes) if (c.file) out.add(c.file);
  }
  return [...out].sort();
}
