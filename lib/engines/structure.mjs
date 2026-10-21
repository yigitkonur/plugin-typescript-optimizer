// Structure-level adapters: micro-file sprawl (struct-08, fs:micro-sprawl), complexity hotspots (struct-09, lint:complexity),
// dual abstraction (reach-11, fs:dual-abstraction). All three are deep-mode, advisory, and read-only: no config is ever written.
import { readFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import { run as runProc } from '../core/proc.mjs';
import { readJsonc, toPosix } from '../core/fs.mjs';
import { SFC_EXT, SOURCE_EXT, isGeneratedPath, isTestPath, packageOf, pathClass } from '../detect/classify.mjs';
import { routeLike } from '../detect/packs.mjs';
import { buildImporterIndex, extractImports } from './importers.mjs';
import { extractScripts, lineAt, lineStarts, maskSource } from './mask.mjs';

export const name = 'structure';
const ADAPTERS = new Set(['fs:micro-sprawl', 'lint:complexity', 'fs:dual-abstraction']);
export const handles = (rule) => ADAPTERS.has(String(rule.adapter || ''));
export const available = () => ({ ok: true });

const MAX_BYTES = 512 * 1024;
const CAP_PER_PACKAGE = 25;
const isDts = (f) => /\.d\.[cm]?ts$/.test(f);
const isCode = (f) => SOURCE_EXT.test(f) && !isDts(f);
const trunc = (s, n = 400) => String(s).slice(0, n);

const mk = (rule, extra) => ({
  rule: rule.id, domain: rule.domain, package: '.', line: 1, col: 1, symbol: null, grain: rule.grain || 'symbol', severity_hint: rule.severity, batch: rule.batch ?? null,
  wave: rule.wave ?? null, fix_mode_hint: rule.fix_mode, consumers: [], triage: rule.triage || 'agent', path_class: 'source', ...extra,
});

async function readSource(root, f) {
  let raw; try { raw = await readFile(join(root, f), 'utf8'); } catch { return null; }
  return raw.length > MAX_BYTES ? null : raw;
}
const scriptText = (f, raw) => (SFC_EXT.test(f) ? extractScripts(raw, posix.extname(f)) : raw);
const codeLoc = (f, raw) => {
  const t = scriptText(f, raw); if (t === null) return 0;
  return (SFC_EXT.test(f) ? t : maskSource(t).code).split('\n').filter((l) => /\S/.test(l)).length;
};

export async function run(ctx) {
  const by = (a) => ctx.rules.find((r) => r.adapter === a);
  const candidates = []; const notes = {};
  const sprawl = by('fs:micro-sprawl'); if (sprawl) candidates.push(...await microSprawl(sprawl, ctx, notes));
  const cx = by('lint:complexity'); if (cx) candidates.push(...await complexity(cx, ctx, notes));
  const dual = by('fs:dual-abstraction'); if (dual) candidates.push(...await dualAbstraction(dual, ctx, notes));
  return { candidates, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// struct-08: depth below src/, pass-through directories, small single-importer files; one candidate per top-level directory cluster.
// ---------------------------------------------------------------------------------------------------------------------------------
async function microSprawl(rule, ctx, notes) {
  const { root, detect: d, files } = ctx;
  const all = ctx.scope?.all_files || files;
  const packages = d.packages || [];
  const frameworks = d.frameworks || [];
  const scoped = new Set(files);
  const byPkg = new Map();
  for (const f of all) { if (!SOURCE_EXT.test(f)) continue; const p = packageOf(f, packages); (byPkg.get(p) || byPkg.set(p, []).get(p)).push(f); }
  let idx = null;
  const clusters = new Map();
  for (const [pkgPath, list] of [...byPkg].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pre = pkgPath === '.' ? '' : pkgPath + '/';
    const srcRoot = list.some((f) => f.startsWith(pre + 'src/')) ? pre + 'src' : pre.replace(/\/$/, '');
    const under = list.filter((f) => srcRoot === '' || f.startsWith(srcRoot + '/'));
    const rel = (f) => (srcRoot ? f.slice(srcRoot.length + 1) : f);
    const kids = new Map(); // dir (relative to the source root) -> Map(child name -> 'd'|'f'), over every source file (tests included)
    for (const f of under) {
      const segs = rel(f).split('/');
      for (let i = 0; i < segs.length; i++) {
        const dir = segs.slice(0, i).join('/');
        (kids.get(dir) || kids.set(dir, new Map()).get(dir)).set(segs[i], i === segs.length - 1 ? 'f' : 'd');
      }
    }
    const eligible = under.filter((f) => scoped.has(f) && isCode(f) && pathClass(f) === 'source' && !routeLike(f, frameworks)).sort();
    const cl = (top) => {
      const k = `${pkgPath}\0${top}`;
      return clusters.get(k) || clusters.set(k, { pkg: pkgPath, srcRoot, top, files: [], deep: [], passThrough: [], singleFile: [], micro: [] }).get(k);
    };
    const tops = new Set();
    for (const f of eligible) { const segs = rel(f).split('/'); if (segs.length > 1) { cl(segs[0]).files.push(f); tops.add(segs[0]); } }
    for (const f of eligible) {
      const segs = rel(f).split('/');
      if (segs.length - 1 > 4) cl(segs[0]).deep.push({ file: f, depth: segs.length - 1 });
    }
    for (const [dir, m] of [...kids].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (dir === '' || m.size !== 1) continue;
      const top = dir.split('/')[0];
      if (!tops.has(top)) continue;
      const [nm, kind] = [...m][0];
      if (kind === 'd') cl(top).passThrough.push(dir);
      else if (dir.split('/').length >= 2 && !/^index\./.test(nm) && eligible.includes(`${srcRoot ? srcRoot + '/' : ''}${dir}/${nm}`)) cl(top).singleFile.push(dir);
    }
    const micro = eligible.filter((f) => rel(f).includes('/') && !/^index\./.test(posix.basename(f)));
    if (micro.length) {
      idx ||= await buildImporterIndex({ root, files: all, packages });
      for (const f of micro) {
        const raw = await readSource(root, f); if (raw === null) continue;
        const loc = codeLoc(f, raw);
        if (loc < 1 || loc >= 30) continue;
        const importers = idx.importersOf(f).filter((i) => !isTestPath(i) && !isGeneratedPath(i));
        if (importers.length !== 1 || posix.dirname(importers[0]) === posix.dirname(f)) continue; // a sibling-only helper is struct-06, not sprawl
        cl(rel(f).split('/')[0]).micro.push({ file: f, loc, importer: importers[0] });
      }
    }
  }
  const out = [];
  for (const c of [...clusters.values()].sort((a, b) => a.pkg.localeCompare(b.pkg) || a.top.localeCompare(b.top))) {
    if (!c.deep.length && c.passThrough.length < 3 && !c.micro.length) continue;
    const maxDepth = Math.max(0, ...c.deep.map((x) => x.depth));
    const parts = [];
    if (c.deep.length) parts.push(`${c.deep.length} file(s) nested ${maxDepth} levels below ${c.srcRoot || '.'} (limit 4)`);
    if (c.passThrough.length) parts.push(`${c.passThrough.length} pass-through director${c.passThrough.length === 1 ? 'y' : 'ies'}`);
    if (c.micro.length) parts.push(`${c.micro.length} file(s) under 30 lines with a single importer in another directory`);
    const members = [...new Set([...c.deep.map((x) => x.file), ...c.micro.map((x) => x.file)])].sort();
    const first = members[0] || c.files[0];
    out.push(mk(rule, {
      engine: 'fs:micro-sprawl', package: c.pkg, file: first, symbol: null, snippet: trunc(`${posix.join(c.srcRoot, c.top)}: ${parts.join('; ')}`),
      raw_ref: 'fs:micro-sprawl', cluster: posix.join(c.srcRoot, c.top), members: members.slice(0, 20),
      signals: { max_depth: maxDepth, deep_files: c.deep.length, pass_through_dirs: c.passThrough.slice(0, 20), single_file_dirs: c.singleFile.slice(0, 20), micro_files: c.micro.slice(0, 20) },
    }));
  }
  notes.micro_sprawl = { clusters: out.length };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// struct-09: the project's own lint engine with CLI rule overrides (read-only), else an in-process keyword-density ranking.
// ---------------------------------------------------------------------------------------------------------------------------------
const NAME_BEFORE = /([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]*?)?=\s*(?:async\s*)?(?:(?:React\.)?(?:useCallback|useMemo|memo|forwardRef|useEffectEvent)\s*(?:<[^>]*>)?\s*\(\s*)?(?:async\s*)?$|([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?$/;
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'super', 'typeof', 'await', 'new', 'delete', 'void', 'throw', 'import', 'require', 'else', 'do', 'try', 'in', 'of', 'case', 'yield']);

function matchClose(code, i, open, close) {
  let depth = 0;
  for (let k = i; k < code.length; k++) { const c = code[k]; if (c === open) depth++; else if (c === close && --depth === 0) return k; }
  return -1;
}
function matchBack(code, i) {
  let depth = 0;
  for (let k = i; k >= 0; k--) { const c = code[k]; if (c === ')') depth++; else if (c === '(' && --depth === 0) return k; }
  return -1;
}
function nameBefore(prefix) {
  const trimmed = prefix.trimEnd(); const tail = trimmed.slice(-240);
  const m = NAME_BEFORE.exec(tail);
  return m ? { name: m[1] || m[2], index: trimmed.length - tail.length + m.index } : null;
}

export function countParams(s) {
  let depth = 0; let n = 0; let any = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '=' && s[k + 1] === '>') { k++; any = true; continue; }
    if (c === ',' && depth === 0) { if (any) n++; any = false; continue; }
    if ('([{<'.includes(c)) depth++; else if (')]}>'.includes(c)) depth = Math.max(0, depth - 1);
    if (!/\s/.test(c)) any = true;
  }
  const total = any ? n + 1 : n;
  return /^\s*this\s*:/.test(s) ? total - 1 : total;
}

/** named functions with a block body in comment/string-masked code: [{ name, nameIdx, open, close, params }] */
export function findFunctions(code) {
  const out = []; const taken = new Set();
  const push = (nameIdx, fname, openParen) => {
    const closeParen = matchClose(code, openParen, '(', ')'); if (closeParen < 0) return;
    const sticky = /\s*(?::[^{;]*)?\{/y; sticky.lastIndex = closeParen + 1;
    if (!sticky.exec(code)) return;
    const open = sticky.lastIndex - 1;
    if (taken.has(open)) return;
    const close = matchClose(code, open, '{', '}'); if (close < 0) return;
    taken.add(open);
    out.push({ name: fname, nameIdx, open, close, params: code.slice(openParen + 1, closeParen) });
  };
  let m;
  const fnRe = /\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^>(]*>)?\s*\(/g;
  while ((m = fnRe.exec(code))) {
    const nb = m[1] ? null : nameBefore(code.slice(Math.max(0, m.index - 240), m.index));
    const fname = m[1] || nb?.name; if (!fname) continue;
    push(m.index, fname, m.index + m[0].length - 1);
  }
  const arRe = /=>\s*\{/g;
  while ((m = arRe.exec(code))) {
    const open = m.index + m[0].length - 1; if (taken.has(open)) continue;
    const before = code.slice(0, m.index).trimEnd();
    let openParen = -1; let paramsEnd = -1; let single = null;
    const last = before[before.length - 1] || '';
    const rt = /\)\s*:\s*[\w$.<>[\]\s|&,?]*$/.exec(before.slice(-200));
    if (last === ')') { paramsEnd = before.length - 1; openParen = matchBack(before, paramsEnd); }
    else if (rt) { paramsEnd = before.length - Math.min(200, before.length) + rt.index; openParen = matchBack(before, paramsEnd); }
    else if (/[\w$]/.test(last)) { const mi = /([A-Za-z_$][\w$]*)$/.exec(before); if (!mi) continue; single = mi; }
    else continue;
    const startAt = single ? single.index : openParen;
    if (startAt < 0) continue;
    const nb = nameBefore(before.slice(0, startAt)); if (!nb) continue;
    taken.add(open);
    const close = matchClose(code, open, '{', '}'); if (close < 0) continue;
    out.push({ name: nb.name, nameIdx: nb.index >= 0 ? nb.index : startAt, open, close, params: single ? single[1] : code.slice(openParen + 1, paramsEnd) });
  }
  const meRe = /(?<![\w$.])((?:(?:public|private|protected|static|async|readonly|override|abstract|get|set|declare)\s+)*)([A-Za-z_$][\w$]*)\s*(?:<[^>(){}]*>)?\s*\(/g;
  while ((m = meRe.exec(code))) {
    if (NOT_A_METHOD.has(m[2])) continue;
    const prev = code.slice(0, m.index).trimEnd().slice(-1);
    if (prev && !'{};,)'.includes(prev)) continue;
    push(m.index, m[2], m.index + m[0].length - 1);
  }
  return out.sort((a, b) => a.nameIdx - b.nameIdx);
}

const TOKEN = /\belse\s+if\b|(?<![\w$.])(?:if|else|for|while|do|switch|case|catch|return|throw)\b|&&=?|\|\|=?|\?\?=?|\?(?![.:?])|[{}();]/g;
/** cyclomatic, cognitive (approximation: nesting-weighted control structures + logical-operator runs) and control nesting depth of a body */
export function measureBody(body) {
  let cyc = 1; let cog = 0; let nest = 0; let maxNest = 0; let paren = 0; let pending = false; let lastOp = null;
  const stack = [];
  const re = new RegExp(TOKEN.source, 'g');
  let m;
  while ((m = re.exec(body))) {
    const t = m[0];
    if (/^else\s+if$/.test(t)) { cyc++; cog += 1; pending = true; }
    else if (t === 'if' || t === 'for' || t === 'while' || t === 'catch') { cyc++; cog += 1 + nest; pending = true; }
    else if (t === 'switch') { cog += 1 + nest; pending = true; }
    else if (t === 'else') { cog += 1; pending = true; }
    else if (t === 'do') pending = true;
    else if (t === 'case') cyc++;
    else if (t === 'return' || t === 'throw') pending = false;
    else if (t === '?') { cyc++; cog += 1 + nest; }
    else if (t === '(') paren++;
    else if (t === ')') paren = Math.max(0, paren - 1);
    else if (t === '{') { if (pending && paren === 0) { stack.push('c'); nest++; maxNest = Math.max(maxNest, nest); pending = false; } else stack.push('o'); lastOp = null; }
    else if (t === '}') { if (stack.pop() === 'c') nest--; lastOp = null; }
    else if (t === ';') { if (paren === 0) pending = false; lastOp = null; }
    else { cyc++; const op = t.replace('=', ''); if (op !== lastOp) cog++; lastOp = op; } // && || ??
  }
  return { cyclomatic: cyc, cognitive: cog, nesting: maxNest };
}

function analyzeFile(file, raw) {
  const text = scriptText(file, raw); if (text === null) return [];
  const code = maskSource(text).code;
  const starts = lineStarts(raw);
  const units = [];
  for (const f of findFunctions(code)) {
    const body = code.slice(f.open + 1, f.close);
    const line = lineAt(starts, f.nameIdx);
    units.push({
      file, line, col: f.nameIdx - starts[line - 1] + 1, symbol: f.name,
      metrics: { ...measureBody(body), loc: lineAt(starts, f.close) - line + 1, params: countParams(f.params) },
    });
  }
  return units;
}

const breachesOf = (m, th) => [
  m.cyclomatic > th.cyclomatic && 'cyclomatic', m.cognitive > th.cognitive && 'cognitive', m.loc > th.function_loc && 'function_loc',
  m.nesting > th.nesting && 'nesting', m.params >= th.params && 'params',
].filter(Boolean);
const scoreOf = (m, th) => Math.round(((m.cyclomatic ?? 0) / th.cyclomatic + (m.cognitive ?? 0) / th.cognitive + (m.loc ?? 0) / th.function_loc + (m.nesting ?? 0) / th.nesting + (m.params ?? 0) / th.params) * 100) / 100;

function describe(m, th) {
  const p = [];
  if (m.cyclomatic != null) p.push(`cyclomatic ${m.cyclomatic} (limit ${th.cyclomatic})`);
  if (m.cognitive != null) p.push(`cognitive ${m.cognitive} (limit ${th.cognitive})`);
  if (m.loc != null) p.push(`${m.loc} lines (limit ${th.function_loc})`);
  if (m.nesting != null) p.push(`nesting ${m.nesting} (limit ${th.nesting})`);
  if (m.params != null) p.push(`${m.params} params (limit ${th.params - 1})`);
  return p.join(', ');
}

/** ESLint with the project's own config plus CLI --rule overrides (nothing is written). Throws on any failure. */
async function eslintUnits(ctx, th, list) {
  const e = ctx.detect.engines?.eslint;
  if (!e?.bin) throw new Error('eslint binary not resolved');
  const overrides = ['--rule', `complexity: [warn, ${th.cyclomatic}]`, '--rule', `max-depth: [warn, ${th.nesting}]`, '--rule', `max-params: [warn, ${Math.max(0, th.params - 1)}]`, '--rule', `max-lines-per-function: [warn, ${th.function_loc}]`];
  const byKey = new Map(); let results = 0; let fatal = 0;
  for (let i = 0; i < list.length; i += 150) {
    const r = await runProc([e.bin, '-f', 'json', ...overrides, '--', ...list.slice(i, i + 150)], { cwd: ctx.root, timeoutMs: 180_000, maxBytes: 128 * 1024 * 1024 });
    if (r.error || r.timedOut || (r.code !== 0 && r.code !== 1)) throw new Error(r.error || (r.timedOut ? 'eslint timed out' : `eslint exit ${r.code}: ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 160)}`));
    let parsed; try { parsed = JSON.parse(r.stdout); } catch { throw new Error('eslint printed no JSON'); }
    if (!Array.isArray(parsed)) throw new Error('eslint JSON has an unexpected shape');
    for (const res of parsed) {
      results++;
      if ((res.messages || []).some((x) => x.fatal)) fatal++;
      const file = toPosix(relative(ctx.root, res.filePath));
      for (const msg of res.messages || []) {
        const num = (re) => { const x = re.exec(msg.message || ''); return x ? Number(x[1]) : null; };
        let key; let metric;
        if (msg.ruleId === 'complexity') metric = { cyclomatic: num(/complexity of (\d+)/) };
        else if (msg.ruleId === 'max-depth') metric = { nesting: num(/\((\d+)\)/) };
        else if (msg.ruleId === 'max-params') metric = { params: num(/parameters \((\d+)\)/) };
        else if (msg.ruleId === 'max-lines-per-function') metric = { loc: num(/lines \((\d+)\)/) };
        else continue;
        const sym = /(?:function|method|constructor|getter|setter)\s+'([^']+)'/i.exec(msg.message || '')?.[1] || null;
        key = `${file}\0${sym || msg.line}`;
        const u = byKey.get(key) || byKey.set(key, { file, line: msg.line || 1, col: msg.column || 1, symbol: sym, metrics: {} }).get(key);
        Object.assign(u.metrics, metric);
      }
    }
  }
  if (results && fatal * 2 >= results) throw new Error(`eslint could not parse ${fatal}/${results} files (its config has no TypeScript parser?)`);
  return [...byKey.values()];
}

/** Biome (also behind Ultracite): the one rule it can run without config is cognitive complexity, default limit 15. Throws on any failure. */
async function biomeUnits(ctx, th, list) {
  const e = ctx.detect.engines?.biome;
  if (!e?.bin) throw new Error('biome binary not resolved');
  const units = [];
  for (let i = 0; i < list.length; i += 200) {
    const r = await runProc([e.bin, 'lint', '--only=complexity/noExcessiveCognitiveComplexity', '--reporter=json', '--max-diagnostics=1000', '--no-errors-on-unmatched', ...list.slice(i, i + 200)], { cwd: ctx.root, timeoutMs: 180_000, maxBytes: 128 * 1024 * 1024 });
    if (r.error || r.timedOut || (r.code !== 0 && r.code !== 1)) throw new Error(r.error || (r.timedOut ? 'biome timed out' : `biome exit ${r.code}: ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 160)}`));
    let parsed; try { parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { throw new Error('biome printed no JSON (reporter unsupported by this version?)'); }
    if (!Array.isArray(parsed.diagnostics)) throw new Error('biome JSON has an unexpected shape');
    for (const dg of parsed.diagnostics) {
      if (!String(dg.category || '').includes('noExcessiveCognitiveComplexity')) continue;
      const loc = dg.location || {};
      const file = toPosix(String(loc.path?.file ?? loc.path ?? '')).replace(/^\.\//, '');
      const score = Number(/complexity of (\d+)/i.exec(dg.description || dg.message || '')?.[1]);
      if (!file || !Number.isFinite(score) || score <= th.cognitive) continue;
      const raw = await readSource(ctx.root, file); if (raw === null) continue;
      const start = Array.isArray(loc.span) ? Number(loc.span[0]) : NaN;
      let line = loc.start?.line ?? 1; let sym = null;
      if (Number.isFinite(start)) {
        line = Buffer.from(raw).subarray(0, start).toString().split('\n').length;
        const nm = /^(?:async\s+)?(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)/.exec(Buffer.from(raw).subarray(start, start + 200).toString());
        if (nm && !NOT_A_METHOD.has(nm[1]) && nm[1] !== 'async') sym = nm[1];
      } else if (loc.start?.line && loc.end?.line === loc.start.line) {
        // Biome 2 reports 1-based start/end columns of the function name instead of a byte span
        const nm = (raw.split('\n')[loc.start.line - 1] || '').slice(loc.start.column - 1, loc.end.column - 1);
        if (/^[A-Za-z_$][\w$]*$/.test(nm) && !NOT_A_METHOD.has(nm)) sym = nm;
      }
      units.push({ file, line, col: 1, symbol: sym, metrics: { cognitive: score } });
    }
  }
  return units;
}

/** ESLint's max-depth reports a block, not a function: fold it into the innermost enclosing function so one function is one candidate */
async function attachBlocks(ctx, units) {
  const merged = new Map(); const cache = new Map();
  for (const u of units) {
    let target = u;
    if (!u.symbol && u.metrics.nesting != null) {
      if (!cache.has(u.file)) {
        const raw = await readSource(ctx.root, u.file);
        const fns = raw === null ? [] : findFunctions(maskSource(raw).code);
        const starts = raw === null ? [] : lineStarts(raw);
        cache.set(u.file, fns.map((f) => ({ ...f, from: lineAt(starts, f.nameIdx), to: lineAt(starts, f.close) })));
      }
      const enc = cache.get(u.file).filter((f) => f.from <= u.line && u.line <= f.to).sort((a, b) => (b.from - a.from))[0];
      if (enc) target = { ...u, symbol: enc.name, line: enc.from, col: 1 };
    }
    const k = `${target.file}\0${target.symbol || target.line}\0${target.symbol ? '' : target.line}`;
    const prev = merged.get(k);
    if (!prev) merged.set(k, { ...target, metrics: { ...target.metrics } });
    else for (const [m, v] of Object.entries(target.metrics)) prev.metrics[m] = Math.max(prev.metrics[m] ?? 0, v);
  }
  return [...merged.values()];
}

async function complexity(rule, ctx, notes) {
  const { root, detect: d, files, config } = ctx;
  const th = { cyclomatic: 10, cognitive: 15, function_loc: 60, nesting: 3, params: 4, ...(config?.thresholds || {}) };
  const list = files.filter((f) => isCode(f) && pathClass(f) === 'source').sort();
  const lintName = d.lint?.engine;
  const key = lintName === 'ultracite' ? 'biome' : lintName;
  let units = null; let engine = null; const info = { engine: 'fallback', lint: lintName || null };
  const nonSfc = list.filter((f) => !SFC_EXT.test(f));
  if ((key === 'biome' || key === 'eslint') && d.engines?.[key]?.works && nonSfc.length) {
    try {
      units = key === 'biome' ? await biomeUnits(ctx, th, nonSfc) : await attachBlocks(ctx, await eslintUnits(ctx, th, nonSfc));
      engine = `lint:complexity:${key}${d.engines[key].version ? '@' + d.engines[key].version : ''}`; info.engine = key;
      for (const f of list.filter((x) => SFC_EXT.test(x))) { const raw = await readSource(root, f); if (raw !== null) units.push(...analyzeFile(f, raw)); }
    } catch (e) { units = null; info.lint_failed = trunc(e.message, 240); }
  } else if (lintName) info.lint_unusable = !d.engines?.[key]?.works ? `${lintName} is not usable here` : 'no lintable files';
  if (!units) {
    engine = 'lint:complexity:fallback'; units = [];
    for (let i = 0; i < list.length; i += 32) {
      const raws = await Promise.all(list.slice(i, i + 32).map((f) => readSource(root, f)));
      raws.forEach((raw, k) => { if (raw !== null) units.push(...analyzeFile(list[i + k], raw)); });
    }
  }
  const ranked = [];
  for (const u of units) {
    const br = breachesOf(u.metrics, th);
    if (!br.length) continue;
    ranked.push({ ...u, breaches: br, score: scoreOf(u.metrics, th), priority: br.includes('cyclomatic') && br.includes('cognitive') });
  }
  ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  const perPkg = new Map(); const out = []; let capped = 0;
  for (const u of ranked) {
    const pkg = packageOf(u.file, d.packages || []);
    const n = perPkg.get(pkg) || 0;
    if (n >= CAP_PER_PACKAGE) { capped++; continue; }
    perPkg.set(pkg, n + 1);
    out.push(mk(rule, {
      engine, package: pkg, file: u.file, line: u.line, col: u.col, symbol: u.symbol, snippet: trunc(`${u.symbol || 'block'}: ${describe(u.metrics, th)}`),
      raw_ref: 'lint:complexity', metrics: u.metrics, breaches: u.breaches, score: u.score, priority: u.priority,
    }));
  }
  notes.complexity = { ...info, functions: units.length, breaching: ranked.length, capped, thresholds: th };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// reach-11: competing libraries in one package.json and shadow v1/v2 directories, ranked by call-site volume.
// ---------------------------------------------------------------------------------------------------------------------------------
const COMPETING = [
  { id: 'http-client', libs: ['axios', 'ky', 'got'] },
  { id: 'lodash', libs: ['lodash', 'lodash-es'] },
  { id: 'date', libs: ['date-fns', 'dayjs', 'moment', 'luxon'] },
  { id: 'state', libs: ['redux', 'zustand'] },
];

async function dualAbstraction(rule, ctx, notes) {
  const { root, detect: d, files } = ctx;
  const all = ctx.scope?.all_files || files;
  const packages = (d.packages || []).filter((p) => p.has_package_json !== false);
  const frameworks = d.frameworks || [];
  const allPackages = d.packages || [];
  const scopedPkgs = new Set(files.map((f) => packageOf(f, allPackages)));
  const out = [];
  for (const p of packages) {
    if (!scopedPkgs.has(p.path)) continue;
    const pre = p.path === '.' ? '' : p.path + '/';
    const mine = all.filter((f) => SOURCE_EXT.test(f) && packageOf(f, allPackages) === p.path && !isGeneratedPath(f));
    // competing library sets
    const pjText = await readFile(join(root, pre, 'package.json'), 'utf8').catch(() => null);
    const pj = pjText === null ? null : readJsonc(join(root, pre, 'package.json'));
    const deps = pj?.ok && pj.value ? { ...(pj.value.devDependencies || {}), ...(pj.value.dependencies || {}) } : {};
    const sets = COMPETING.map((s) => ({ ...s, present: s.libs.filter((l) => Object.hasOwn(deps, l)) })).filter((s) => s.present.length >= 2);
    if (sets.length) {
      const sites = new Map(); // lib -> Set(files)
      const wanted = new Set(sets.flatMap((s) => s.present));
      for (let i = 0; i < mine.length; i += 32) {
        const raws = await Promise.all(mine.slice(i, i + 32).map((f) => readSource(root, f)));
        raws.forEach((raw, k) => {
          const f = mine[i + k]; if (raw === null) return;
          const text = scriptText(f, raw); if (text === null) return;
          const counted = new Map();
          for (const imp of extractImports(text)) for (const l of wanted) if (imp.spec === l || imp.spec.startsWith(l + '/')) counted.set(l, (counted.get(l) || 0) + 1);
          for (const [l, n] of counted) (sites.get(l) || sites.set(l, []).get(l)).push({ file: f, n });
        });
      }
      for (const s of sets) {
        const libs = s.present.map((l) => ({ name: l, call_sites: (sites.get(l) || []).reduce((a, x) => a + x.n, 0), files: (sites.get(l) || []).map((x) => x.file).sort() }))
          .sort((a, b) => b.call_sites - a.call_sites || a.name.localeCompare(b.name));
        const live = libs.filter((l) => l.call_sites > 0);
        if (live.length < 2) continue; // a dependency nobody imports is reach-07's, not a stalled migration
        const lineOfDep = Math.min(...s.present.map((l) => { const i = pjText.split('\n').findIndex((ln) => ln.includes(`"${l}"`)); return i < 0 ? 1e9 : i + 1; }));
        out.push(mk(rule, {
          engine: 'fs:dual-abstraction', package: p.path, file: `${pre}package.json`, line: lineOfDep < 1e9 ? lineOfDep : 1, symbol: libs.map((l) => l.name).sort().join('+'),
          snippet: trunc(`${s.id}: ${libs.map((l) => `${l.name} (${l.call_sites} call sites)`).join(' vs ')}; survivor by volume: ${libs[0].name}`),
          raw_ref: `fs:dual-abstraction:${s.id}`, survivor: libs[0].name, libraries: libs.map(({ name: n, call_sites }) => ({ name: n, call_sites })),
          consumers: [...new Set(libs.slice(1).flatMap((l) => l.files))].slice(0, 50),
        }));
      }
    }
    // shadow directories: v1/ beside v2/ under one parent, both holding source
    const srcDirs = new Map(); // parent -> Map(vN -> [files])
    for (const f of mine) {
      if (isTestPath(f) || routeLike(f, frameworks)) continue;
      const segs = f.slice(pre.length).split('/');
      for (let i = 0; i < segs.length - 1; i++) {
        if (!/^v\d+$/.test(segs[i])) continue;
        const parent = segs.slice(0, i).join('/');
        const m = srcDirs.get(parent) || srcDirs.set(parent, new Map()).get(parent);
        (m.get(segs[i]) || m.set(segs[i], []).get(segs[i])).push(f);
      }
    }
    for (const [parent, versions] of [...srcDirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (versions.size < 2) continue;
      const names = [...versions.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      const first = versions.get(names[0]).sort()[0];
      out.push(mk(rule, {
        engine: 'fs:dual-abstraction', package: p.path, file: first, symbol: names.join('+'),
        snippet: trunc(`${names.join('/ beside ')}/ under ${parent || '.'}: ${names.map((n) => `${versions.get(n).length} files in ${n}`).join(', ')}`),
        raw_ref: 'fs:dual-abstraction:shadow-dirs', parent, versions: names,
      }));
    }
  }
  notes.dual_abstraction = { clusters: out.length };
  return out;
}
