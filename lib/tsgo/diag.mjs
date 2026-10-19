// Diagnostics for the fit comparison (doc 05 §8.3 step 3, §9.1): parse tsc output, normalise, compare as multisets,
// classify one-sided items with the known-divergence table. Declaration text is never compared, only diagnostics.
import { sha1 } from '../core/hash.mjs';
import { parseDiagnostics } from '../engines/project.mjs';

/** tsc --pretty false output -> [{file, line, col, severity, code, message}]; global errors (no file) have file '' */
export function parseTsc(out) {
  const diags = parseDiagnostics(out).map((d) => ({ ...d }));
  const withFile = new Set(diags.map((d) => `${d.code}:${d.message}`));
  for (const line of String(out).split('\n')) {
    const m = /^(error|warning) (TS\d+): (.*)$/.exec(line.trim());
    if (m && !line.startsWith(' ') && !withFile.has(`${m[2]}:${m[3]}`)) diags.push({ file: '', line: 0, col: 0, severity: m[1], code: m[2], message: m[3] });
  }
  return diags;
}

/** message with absolute paths made relative, line/col numbers removed, whitespace collapsed */
export function normaliseMessage(msg, prefixes = []) {
  let s = String(msg || '');
  for (const p of prefixes) if (p) s = s.split(p.replace(/\\/g, '/') + '/').join('').split(p + '/').join('');
  return s.replace(/\(\d+,\d+\)/g, '').replace(/:\d+:\d+\b/g, '').replace(/\s+/g, ' ').trim();
}

/** repo-relative file for a diagnostic printed relative to `cwdRel` (the package directory, '' or '.' for the root) */
export function repoFile(file, cwdRel) {
  if (!file) return '';
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!cwdRel || cwdRel === '.') return f;
  return /^([a-zA-Z]:)?\//.test(f) || f.startsWith(cwdRel + '/') ? f : `${cwdRel}/${f}`;
}

export function keyOf(d, prefixes = []) { return `${d.file}|${d.code}|${normaliseMessage(d.message, prefixes)}`; }
export const fingerprintOf = (d, prefixes = []) => 'sha1:' + sha1(keyOf(d, prefixes));

/** group into a multiset: Map(key -> {count, sample}) */
export function multiset(diags, prefixes = []) {
  const m = new Map();
  for (const d of diags) {
    const k = keyOf(d, prefixes);
    const e = m.get(k);
    if (e) e.count++; else m.set(k, { count: 1, sample: d });
  }
  return m;
}

/**
 * Compare two multisets. -> { equal, only_a: [{...diag, count}], only_b: [...] }  (a = authoritative, b = native)
 * An item is "only on one side" for the excess count on that side.
 */
export function compareMultisets(a, b) {
  const onlyA = []; const onlyB = [];
  for (const [k, e] of a) { const extra = e.count - (b.get(k)?.count || 0); if (extra > 0) onlyA.push({ ...e.sample, count: extra }); }
  for (const [k, e] of b) { const extra = e.count - (a.get(k)?.count || 0); if (extra > 0) onlyB.push({ ...e.sample, count: extra }); }
  const sort = (x, y) => x.file.localeCompare(y.file) || x.line - y.line || x.code.localeCompare(y.code);
  return { equal: !onlyA.length && !onlyB.length, only_a: onlyA.sort(sort), only_b: onlyB.sort(sort) };
}

const CONFIG_CODES = new Set(['TS5101', 'TS5102', 'TS5107', 'TS5108', 'TS5023', 'TS6046', 'TS5095', 'TS5110', 'TS5103']);
const JS_FILE = /\.(?:[cm]?jsx?)$/;

/**
 * Known-divergence table (doc 05 §8.3 step 3). One-sided diagnostic -> {category, rule, detail}.
 * categories: removed-option (tc-01) · default-change (tc-03, with the default id) · jsdoc (tc-09) · wording (same file+code on both sides, message differs)
 *             · skiplibcheck-conflict (conflicting declarations, doc 05 §8.3) · unexplained (tc-11)
 * ctx: { defaults: defaults-changes.json entries, other: the other side's one-sided list (for wording pairs), side: 'native'|'authoritative' }
 */
export function classifyDivergence(d, { defaults = [], other = [], removedCodes = CONFIG_CODES } = {}) {
  if (removedCodes.has(d.code)) return { category: 'removed-option', rule: 'tc-01', detail: 'configuration diagnostic about an option the native compiler rejects or renames' };
  for (const e of defaults) {
    if ((e.diagnostic_codes || []).includes(d.code) || (e.diagnostic_code_prefixes || []).some((p) => d.code.startsWith(p))) {
      return { category: 'default-change', rule: 'tc-03', default: e.id, detail: `${e.option} default changed (${e.flipped_in}); ${d.code}` };
    }
  }
  if (JS_FILE.test(d.file)) return { category: 'jsdoc', rule: 'tc-09', detail: 'JavaScript/JSDoc checking differs in the native compiler (typescript-go CHANGES.md)' };
  if (['TS2300', 'TS2451', 'TS2403', 'TS2717', 'TS2374'].includes(d.code)) return { category: 'skiplibcheck-conflict', rule: 'tc-11', detail: 'conflicting declarations are reported at every contributing site (skipLibCheck interaction)' };
  if (other.some((o) => o.file === d.file && o.code === d.code)) return { category: 'wording', rule: null, detail: 'same file and code on both sides, message text differs' };
  return { category: 'unexplained', rule: 'tc-11', detail: 'no known divergence explains this item' };
}

/** classify both one-sided lists. -> { only_authoritative, only_native, summary:{by_category, unexplained} } */
export function classifyAll({ only_a, only_b }, defaults = []) {
  const tag = (list, other) => list.map((d) => ({ ...d, ...classifyDivergence(d, { defaults, other }) }));
  const oa = tag(only_a, only_b); const on = tag(only_b, only_a);
  const by = {};
  let unexplained = 0;
  for (const d of [...oa, ...on]) { by[d.category] = (by[d.category] || 0) + d.count; if (d.category === 'unexplained') unexplained += d.count; }
  return { only_authoritative: oa, only_native: on, summary: { by_category: by, unexplained } };
}
