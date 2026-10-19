// Import-edge index (doc 02): file -> file edges with tsconfig `paths`/extension resolution and workspace package entries.
// Supplies `consumers` for findings, single-consumer / test-importer classification, and the built-in cycle fallback.
import { readFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { readJsonc } from '../core/fs.mjs';
import { SFC_EXT, packageOf } from '../detect/classify.mjs';
import { blankComments, extractScripts } from './mask.mjs';

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'];
const JS_TO_TS = { '.js': ['.ts', '.tsx', '.js'], '.jsx': ['.tsx', '.jsx'], '.mjs': ['.mts', '.mjs'], '.cjs': ['.cts', '.cjs'] };

const IMPORT_RE = /(?<![\w$.])import\s+(type\s+)?([\w$]+)?\s*,?\s*(\{[^}]*\}|\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g;
const SIDE_RE = /(?<![\w$.])import\s*['"]([^'"]+)['"]/g;
const REEXPORT_RE = /(?<![\w$.])export\s+(type\s+)?(\*(?:\s+as\s+([\w$]+))?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /(?<![\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /(?<![\w$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function namesOf(braces) {
  if (!braces || !braces.startsWith('{')) return { names: [], allType: false };
  const parts = braces.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
  let types = 0;
  const names = parts.map((p) => {
    const isType = /^type\s+/.test(p);
    if (isType) types++;
    return p.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
  });
  return { names, allType: parts.length > 0 && types === parts.length };
}

export function extractImports(text) {
  const t = blankComments(text);
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(t))) {
    const { names, allType } = namesOf(m[3]);
    const ns = m[3] && m[3].startsWith('*');
    out.push({ spec: m[5], kind: m[1] || allType ? 'type' : 'value', names: [...(m[2] ? ['default'] : []), ...names], star: !!ns });
  }
  SIDE_RE.lastIndex = 0;
  while ((m = SIDE_RE.exec(t))) out.push({ spec: m[1], kind: 'value', names: [], star: false, sideEffect: true });
  REEXPORT_RE.lastIndex = 0;
  while ((m = REEXPORT_RE.exec(t))) {
    const { names, allType } = namesOf(m[2]);
    out.push({ spec: m[4], kind: m[1] || allType ? 'type' : 'reexport', names, star: m[2].startsWith('*'), reexport: true });
  }
  DYNAMIC_RE.lastIndex = 0;
  while ((m = DYNAMIC_RE.exec(t))) out.push({ spec: m[1], kind: 'dynamic', names: [], star: true });
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(t))) out.push({ spec: m[1], kind: 'value', names: [], star: true });
  return out;
}

export async function buildImporterIndex({ root, files, allFiles = files, packages = [] }) {
  const fileSet = new Set(allFiles);
  const pkgByName = new Map(packages.filter((p) => p.name).map((p) => [p.name, p]));
  // per-package `paths` mapping (tsconfig dir relative)
  const pathMaps = new Map();
  for (const p of packages) {
    const dir = p.path === '.' ? '' : p.path;
    for (const c of p.tsconfigs || []) {
      if (c.class === 'solution') continue;
      const cfg = readJsonc(join(root, dir, c.file));
      const co = cfg.ok && cfg.value?.compilerOptions;
      const paths = co?.paths;
      if (paths && typeof paths === 'object' && !pathMaps.has(p.path)) pathMaps.set(p.path, { base: posix.join(dir, co.baseUrl || '.'), paths });
    }
  }

  const tryFile = (base) => {
    if (fileSet.has(base)) return base;
    const ext = posix.extname(base);
    if (JS_TO_TS[ext]) for (const e of JS_TO_TS[ext]) { const c = base.slice(0, -ext.length) + e; if (fileSet.has(c)) return c; }
    for (const e of TS_EXTS) if (fileSet.has(base + e)) return base + e;
    for (const e of TS_EXTS) if (fileSet.has(posix.join(base, 'index' + e))) return posix.join(base, 'index' + e);
    return null;
  };
  const pkgEntry = (p) => {
    const dir = p.path === '.' ? '' : p.path;
    const pj = readJsonc(join(root, dir, 'package.json'));
    const v = pj.ok ? pj.value : {};
    const cands = [v.types, v.typings, typeof v.exports === 'string' ? v.exports : v.exports?.['.']?.types ?? v.exports?.['.']?.import ?? v.exports?.['.']?.default, v.module, v.main]
      .filter((x) => typeof x === 'string');
    for (const c of cands) {
      const rel = posix.join(dir, c.replace(/^\.\//, ''));
      const hit = tryFile(rel) || tryFile(rel.replace(/(^|\/)dist\//, '$1src/').replace(/\.d\.(m|c)?ts$/, '.$1ts').replace(/\.(m|c)?js$/, ''));
      if (hit) return hit;
    }
    return tryFile(posix.join(dir, 'src', 'index')) || tryFile(posix.join(dir, 'index'));
  };
  const resolve = (from, spec) => {
    if (spec.startsWith('.')) return tryFile(posix.normalize(posix.join(posix.dirname(from), spec)));
    if (spec.startsWith('node:') || spec.startsWith('#')) return null;
    const pkgPath = packageOf(from, packages);
    const pm = pathMaps.get(pkgPath);
    if (pm) for (const [pat, targets] of Object.entries(pm.paths)) {
      const star = pat.indexOf('*');
      const hit = star < 0 ? spec === pat && '' : spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1)) && spec.slice(star, spec.length - (pat.length - star - 1));
      if (hit === false || hit === undefined || hit === null || (star < 0 && hit !== '')) continue;
      for (const t of targets) { const r = tryFile(posix.normalize(posix.join(pm.base, star < 0 ? t : t.replace('*', hit)))); if (r) return r; }
    }
    // workspace package by name (and deep import `@scope/pkg/sub`)
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const wp = pkgByName.get(name);
    if (wp) {
      const rest = spec.slice(name.length + 1);
      if (rest) return tryFile(posix.join(wp.path === '.' ? '' : wp.path, rest)) || tryFile(posix.join(wp.path === '.' ? '' : wp.path, 'src', rest));
      return pkgEntry(wp);
    }
    return null;
  };

  const edges = new Map(); const importers = new Map();
  const CONC = 64;
  const scan = async (f) => {
    let raw; try { raw = await readFile(join(root, f), 'utf8'); } catch { return; }
    if (raw.length > 1024 * 1024) return;
    let text = raw;
    if (SFC_EXT.test(f)) { text = extractScripts(raw, posix.extname(f)); if (text === null) return; }
    const list = [];
    for (const imp of extractImports(text)) {
      const to = resolve(f, imp.spec);
      if (!to || to === f) continue;
      list.push({ to, kind: imp.kind, names: imp.names, star: imp.star, reexport: !!imp.reexport });
      (importers.get(to) || importers.set(to, []).get(to)).push({ from: f, kind: imp.kind, names: imp.names, star: imp.star, reexport: !!imp.reexport });
    }
    edges.set(f, list);
  };
  for (let i = 0; i < files.length; i += CONC) await Promise.all(files.slice(i, i + CONC).map(scan));

  const idx = {
    edges, importers,
    importersOf: (file) => [...new Set((importers.get(file) || []).map((e) => e.from))].sort(),
    consumersOfSymbol: (file, name) => [...new Set((importers.get(file) || []).filter((e) => e.star || e.names.includes(name) || e.names.includes('default') && name === 'default').map((e) => e.from))].sort(),
    importsOf: (file) => [...new Set((edges.get(file) || []).map((e) => e.to))].sort(),
    /** Tarjan SCCs over value edges (type-only edges cannot create init-order cycles) */
    cycles() {
      const index = new Map(); const low = new Map(); const on = new Set(); const stack = []; const out = []; let i = 0;
      const nodes = [...edges.keys()].sort();
      const succ = (n) => [...new Set((edges.get(n) || []).filter((e) => e.kind !== 'type' && e.kind !== 'dynamic').map((e) => e.to))].sort();
      const strong = (v) => {
        const work = [[v, succ(v), 0]];
        index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
        while (work.length) {
          const frame = work[work.length - 1]; const [n, s] = frame;
          if (frame[2] < s.length) {
            const w = s[frame[2]++];
            if (!index.has(w)) { index.set(w, i); low.set(w, i); i++; stack.push(w); on.add(w); work.push([w, succ(w), 0]); }
            else if (on.has(w)) low.set(n, Math.min(low.get(n), index.get(w)));
          } else {
            work.pop();
            if (work.length) { const parent = work[work.length - 1][0]; low.set(parent, Math.min(low.get(parent), low.get(n))); }
            if (low.get(n) === index.get(n)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== n); if (comp.length > 1) out.push(comp.sort()); }
          }
        }
      };
      for (const n of nodes) if (!index.has(n)) strong(n);
      return out.sort((a, b) => a[0].localeCompare(b[0]));
    },
  };
  return idx;
}
export { dirname };
