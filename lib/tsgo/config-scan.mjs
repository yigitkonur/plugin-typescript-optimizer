// Static pass over resolved tsconfig chains (doc 05 §8.3 step 1): removed options (tc-01/02), default-change exposure (tc-03),
// `paths` shape and baseUrl-only imports (tc-02). The option's file:line is the line of the key in the chain file that
// WINS (later `extends` entries and the leaf override earlier ones), not the leaf that happens to extend it.
import { readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readText, toPosix } from '../core/fs.mjs';
import { readTsconfig } from '../detect/tsconfig.mjs';
import { extractImports, packageOfSpecifier } from './imports.mjs';
import { lineText, parseLocated, prop, toValue } from './jsonloc.mjs';

const lc = (s) => String(s).toLowerCase();

/**
 * Pure: merge `compilerOptions` of an ordered chain (base first, leaf last).
 * files: [{file, text}] -> Map(lowercased option -> {name, value, node, file, line, col})
 */
export function collectOptions(files) {
  const map = new Map();
  for (const f of files) {
    const root = parseLocated(f.text);
    const co = prop(root, 'compilerOptions');
    if (!co || co.node.type !== 'object') continue;
    for (const [name, p] of co.node.props) map.set(lc(name), { name, value: toValue(p.node), node: p.node, file: f.file, line: p.line, col: p.col, text: f.text });
  }
  return map;
}

/** FS wrapper: resolve one tsconfig's extends chain (via detect's readTsconfig) and collect options with origins. */
export function resolveChainOptions(absFile, root) {
  const cfg = readTsconfig(absFile, { stopAt: root });
  const chain = cfg.chain.length ? cfg.chain : [absFile];
  const files = [];
  for (const f of chain) { const text = readText(f); if (text !== null) files.push({ file: f, text }); }
  return { options: collectOptions(files), chain, unresolved_extends: cfg.unresolved_extends || [], parse_error: cfg.parse_error || null };
}

const matches = (entry, value) => {
  const m = entry.match || { any: true };
  if (m.any) return true;
  if ('value' in m) return value === m.value;
  if (m.values) return typeof value === 'string' && m.values.includes(lc(value));
  return false;
};

/**
 * Pure: options Map x removed-options.json -> hits.
 * relFile(abs|string) -> repo-relative path used in the output.
 */
export function evalRemoved(options, data, relFile = (f) => f) {
  const hits = [];
  for (const entry of data?.entries || []) {
    const o = options.get(lc(entry.option));
    if (!o || !matches(entry, o.value)) continue;
    const ts7 = entry.ts7 || {};
    hits.push({
      option: o.name, value: o.value, entry: entry.id, kind: entry.kind, removed_in: entry.removed_in,
      rules: entry.rules || ['tc-01'], fix_mode: entry.fix_mode || 'assisted',
      file: relFile(o.file), line: o.line, col: o.col, code: ts7.code || null, message: ts7.message || null,
      remedy: entry.remedy || null, verified: entry.verified || null, text: lineText(o.text, o.line),
    });
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.option.localeCompare(b.option));
}

/**
 * Pure: default-change exposure. ctx = { authMajor: number|null, atTypes: bool, libReplacementPackages: bool }.
 * -> [{id, option, old_default, new_default, flipped_in, effective: bool, already_effective_on_authority: bool, symptom, remedy}]
 * `effective` is true when the flip changes what the AUTHORITATIVE compiler does today (its major is below the flip).
 */
export function evalDefaultExposure(options, data, ctx = {}) {
  const out = [];
  const has = (k) => options.has(lc(k));
  for (const e of data?.entries || []) {
    if ((e.requires_absent || []).some(has)) continue;
    const conds = e.conditions || [];
    if (conds.includes('at-types-installed') && !ctx.atTypes) continue;
    if (conds.includes('lib-replacement-packages') && !ctx.libReplacementPackages) continue;
    if (conds.includes('emit-layout') && !(has('outDir') || has('outFile') || options.get('declaration')?.value === true || options.get('composite')?.value === true)) continue;
    const flipMajor = Number(String(e.flipped_in || '7').split('.')[0]);
    const already = ctx.authMajor != null && ctx.authMajor >= flipMajor;
    out.push({
      id: e.id, option: e.option, old_default: e.old_default, new_default: e.new_default, flipped_in: e.flipped_in,
      already_effective_on_authority: already, effective: !already, symptom: e.symptom, remedy: e.remedy, fix_mode: e.fix_mode,
      diagnostic_codes: e.diagnostic_codes || [], diagnostic_code_prefixes: e.diagnostic_code_prefixes || [],
    });
  }
  return out;
}

/** `paths` values that are not tsconfig-relative (they only worked through baseUrl). -> [{key, value, file, line}] */
export function evalPathsShape(options, relFile = (f) => f) {
  const o = options.get('paths');
  const out = [];
  if (!o || o.node.type !== 'object') return out;
  for (const [key, p] of o.node.props) {
    if (p.node.type !== 'array') continue;
    for (const item of p.node.items) {
      if (item.type !== 'string') continue;
      if (/^\.{1,2}(\/|$)/.test(item.value) || isAbsolute(item.value)) continue;
      out.push({ key, value: item.value, file: relFile(o.file), line: item.line, col: item.col });
    }
  }
  return out;
}

/** entries (dirs, and files without extension) directly under a directory -> Set of import-head names */
export function topLevelNames(dir) {
  const names = new Set();
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return names; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    names.add(e.isDirectory() ? e.name : e.name.replace(/\.[cm]?[jt]sx?$/, '').replace(/\.d$/, ''));
  }
  return names;
}

const NODE_BUILTINS = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib', 'test']);

/**
 * Non-relative specifiers whose head names something under baseUrl and nothing installed (they resolve only through baseUrl).
 * sources: [{file, text}] (repo-relative). names: Set from topLevelNames(baseUrlDir). isInstalled(name) -> bool.
 * aliasKeys: tsconfig `paths` keys (their heads are aliases, not baseUrl hits).
 * -> [{file, line, col, spec, head}]
 */
export function findBaseUrlImports({ sources, names, isInstalled, aliasKeys = [] }) {
  const aliasHeads = new Set(aliasKeys.map((k) => k.replace(/\/?\*.*$/, '').split('/')[0]).filter(Boolean));
  const hits = [];
  for (const s of sources) {
    for (const imp of extractImports(s.text)) {
      const spec = imp.spec;
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('#') || /^[a-z]+:/i.test(spec)) continue;
      const head = spec.split('/')[0];
      if (spec.startsWith('@') || NODE_BUILTINS.has(head) || aliasHeads.has(head)) continue;
      if (!names.has(head) || isInstalled(packageOfSpecifier(spec))) continue;
      hits.push({ file: s.file, line: imp.line, col: imp.col, spec, head });
    }
  }
  return hits;
}

/** repo-relative posix path */
export const relTo = (root) => (abs) => (isAbsolute(abs) ? toPosix(relative(root, abs)) : toPosix(abs));
export { dirname, join, resolve };
