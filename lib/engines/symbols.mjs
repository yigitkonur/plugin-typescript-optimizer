// Symbol-index detectors (doc 06 §14): struct-07 duplicate utilities, struct-06 single-consumer helper, type-03 schema/type dual declaration.
// A light declaration scanner over comment/string-masked source (no TypeScript API): function declarations and const/arrow functions,
// their extent, a normalised-token body hash, and the importer index for consumers. The engine locates, the agent judges.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, posix } from 'node:path';
import { SFC_EXT, hasGeneratedMarker, isGeneratedPath, isTestPath, packageOf } from '../detect/classify.mjs';
import { buildImporterIndex } from './importers.mjs';
import { blankComments, extractScripts, lineAt, lineStarts, maskSource } from './mask.mjs';

export const name = 'symbols';
const ADAPTERS = new Set(['symbols:duplicate-utilities', 'symbols+importers:single-consumer', 'symbols:schema-dual']); // not symbols:implementers (struct-04)
export const handles = (rule) => ADAPTERS.has(String(rule.adapter || ''));
export const available = () => ({ ok: true });

// struct-07 catalogue (rule text): exact names only, so `slugify` never matches `slugifyFilename`
export const UTILITY_NAMES = new Set(['cn', 'clsx', 'twMerge', 'formatDate', 'formatTime', 'formatTimestamp', 'formatCurrency', 'toIsoString', 'slugify', 'capitalize', 'truncate', 'sanitizeString', 'sleep', 'delay', 'clamp', 'safeJsonParse', 'isEmpty', 'isNil']);
const MAX_BYTES = 512 * 1024;
const CONCURRENCY = 64;
const SHARED_DIR = /(^|\/)(utils|helpers|shared|lib)\//; // directory segments only: the file name does not count
const VALIDATOR_IMPORT = /\bfrom\s*['"](?:zod(?:\/[^'"]*)?|valibot|@valibot\/valibot|yup|arktype)['"]|\brequire\(\s*['"](?:zod|valibot|yup|arktype)['"]\s*\)/;
const SCHEMA_BUILDER = /^\s*(?:(?:z|zod|v|valibot|yup|Yup)\s*\.\s*(?:object|strictObject|looseObject)|object|strictObject|looseObject|type)\s*(?:<[^()]*>)?\s*\(/;
const DECL_RE = /(?<![\w$.])(export\s+(?:default\s+)?)?(?:declare\s+)?(?:(async\s+)?function\s*\*?\s*([\w$]+)|(?:const|let|var)\s+([\w$]+))/g;

// ---------- scanning helpers (operate on masked code: comments and string/template text blanked, offsets preserved) ----------

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
function skipWs(s, i) { while (i < s.length && isSpace(s[i])) i++; return i; }
function prevSig(s, i) { i--; while (i >= 0 && isSpace(s[i])) i--; return i; }

/** index of the bracket closing the one opened at `open`, or -1 */
function matchClose(s, open) {
  const o = s[open]; const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) depth++;
    else if (s[i] === c && --depth === 0) return i;
  }
  return -1;
}

/** end (exclusive) of the statement starting at `i`: `;` at depth 0, or a newline at depth 0 where the next line starts a new statement */
function statementEnd(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return i; depth--; }
    else if (ch === ';' && depth === 0) return i + 1;
    else if (ch === '\n' && depth === 0) {
      const p = prevSig(s, i); const n = skipWs(s, i);
      if (n >= s.length) return i;
      if (p >= 0 && ('=+-*/&|?:,('.includes(s[p]) || (s[p] === '>' && s[p - 1] === '='))) continue; // operator or `=>` at line end: the expression continues
      if ('.?:+-*/&|,)]}='.includes(s[n])) continue; // continuation at line start
      return i; // a new statement starts on the next line
    }
  }
  return s.length;
}

/** after the `)` of a parameter list: skip an optional return type and return the index of the body `{`, or -1 (overload / declaration only) */
function bodyBrace(s, i) {
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === ';') return -1;
    if (ch === '(' || ch === '[') { const e = matchClose(s, i); if (e < 0) return -1; i = e; continue; }
    if (ch === '{') {
      const p = prevSig(s, i);
      if (p >= 0 && ':|&<,('.includes(s[p])) { const e = matchClose(s, i); if (e < 0) return -1; i = e; continue; } // `{` of a type literal in the return type
      return i;
    }
  }
  return -1;
}

/** does the expression starting at `i` (just after `=`) read as a function? */
function isFunctionExpr(s, i) {
  const j = skipWs(s, i);
  const rest = s.slice(j, j + 400);
  if (/^(?:async\s+)?function\b/.test(rest)) return true;
  if (/^(?:async\s+)?[\w$]+\s*=>/.test(rest)) return true;
  const g = /^(?:async\s+)?(?:<[^()]*>\s*)?\(/.exec(rest);
  if (!g) return false;
  const open = j + g[0].length - 1; const close = matchClose(s, open);
  return close >= 0 && /^\s*(?::[^;{}]*?)?=>/.test(s.slice(close + 1, close + 300)) || close >= 0 && /^\s*:\s*\{[^}]*\}\s*=>/.test(s.slice(close + 1, close + 300));
}

// ---------- tokenizer + positional renaming for the body hash ----------

const PUNCT3 = ['...', '===', '!==', '>>>', '**=', '<<=', '>>=', '&&=', '||=', '??='];
const PUNCT2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);

/** text (comments already blanked) -> tokens [{t:'id'|'num'|'str'|'re'|'p', v}] ; template literals keep their `${}` expressions as tokens */
export function tokenize(src) {
  const toks = [];
  const stack = []; // template contexts: brace depth inside `${`
  let i = 0; const n = src.length;
  const readTemplateChunk = () => { // i is just after "`" or "}" closing a ${}
    let v = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { v += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; toks.push({ t: 'str', v: '`' + v + '`' }); return false; }
      if (c === '$' && src[i + 1] === '{') { i += 2; toks.push({ t: 'str', v: '`' + v + '${' }); stack.push(0); return true; }
      v += c; i++;
    }
    toks.push({ t: 'str', v: '`' + v }); return false;
  };
  while (i < n) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; toks.push({ t: 'str', v: src.slice(i, j + 1) }); i = j + 1; continue; }
    if (c === '`') { i++; readTemplateChunk(); continue; }
    if (c === '/') {
      const p = toks[toks.length - 1];
      const regexOk = !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && REGEX_AFTER_WORD.has(p.v));
      if (regexOk && src[i + 1] !== '/' && src[i + 1] !== '*') {
        let j = i + 1; let cls = false;
        while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
        if (src[j] === '/') { j++; while (j < n && /[a-z]/i.test(src[j])) j++; toks.push({ t: 're', v: src.slice(i, j) }); i = j; continue; }
      }
    }
    if (stack.length && c === '{') { stack[stack.length - 1]++; toks.push({ t: 'p', v: '{' }); i++; continue; }
    if (stack.length && c === '}') {
      if (stack[stack.length - 1] === 0) { stack.pop(); i++; if (readTemplateChunk()) { /* nested again */ } continue; }
      stack[stack.length - 1]--; toks.push({ t: 'p', v: '}' }); i++; continue;
    }
    const three = src.slice(i, i + 3); const two = src.slice(i, i + 2);
    const v = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
    toks.push({ t: 'p', v }); i += v.length;
  }
  return toks;
}

/** names declared by this token stream: params (function(...) and arrow forms), const/let/var, catch bindings; returned in first-declaration order */
function declaredNames(toks) {
  const names = []; const add = (k) => { if (!names.includes(toks[k].v)) names.push(toks[k].v); };
  const group = (open) => { // identifiers directly in the parameter group at `open`
    let depth = 0;
    for (let k = open; k < toks.length; k++) {
      const v = toks[k].t === 'p' ? toks[k].v : null;
      if (v === '(' || v === '[' || v === '{') depth++;
      else if (v === ')' || v === ']' || v === '}') { if (--depth === 0) return; }
      else if (depth === 1 && toks[k].t === 'id') {
        const pv = toks[k - 1]?.v; const nv = toks[k + 1]?.v;
        if ((pv === '(' || pv === ',' || pv === '...') && (nv === ':' || nv === ',' || nv === ')' || nv === '=' || nv === '?')) add(k);
      }
    }
  };
  const openOf = (close) => { let d = 0; for (let k = close; k >= 0; k--) { if (toks[k].v === ')') d++; else if (toks[k].v === '(' && --d === 0) return k; } return -1; };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'id' && (t.v === 'const' || t.v === 'let' || t.v === 'var') && toks[k + 1]?.t === 'id') add(k + 1);
    else if (t.t === 'id' && t.v === 'function') { let j = k + 1; if (toks[j]?.v === '*') j++; if (toks[j]?.t === 'id') j++; if (toks[j]?.v === '<') { while (j < toks.length && toks[j].v !== '>') j++; j++; } if (toks[j]?.v === '(') group(j); }
    else if (t.t === 'id' && t.v === 'catch' && toks[k + 1]?.v === '(' && toks[k + 2]?.t === 'id') add(k + 2);
    else if (t.v === '=>' && t.t === 'p') {
      const p = toks[k - 1];
      if (p?.t === 'id') add(k - 1);
      else if (p?.v === ')') { const o = openOf(k - 1); if (o >= 0) group(o); }
    }
  }
  return names;
}

/** hash of the normalised token stream: comments gone (caller), whitespace gone, declared names renamed positionally */
export function bodyHash(text) {
  const toks = tokenize(text);
  const names = declaredNames(toks);
  const out = toks.map((t, k) => (t.t === 'id' && names.includes(t.v) && toks[k - 1]?.v !== '.' && toks[k - 1]?.v !== '?.' ? '$' + names.indexOf(t.v) : t.v));
  return createHash('sha1').update(out.join(' ')).digest('hex').slice(0, 12);
}

// ---------- per-file extraction ----------

/** -> { exports:Set, defs:[{name, exported, isFn, line, col, endLine, loc, hash, snippet}] } */
export function extractDefs(raw) {
  const { code } = maskSource(raw);
  const noComments = blankComments(raw);
  const starts = lineStarts(raw);
  const exportedNames = new Set();
  for (const m of code.matchAll(/(?<![\w$.])export\s*(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) for (const part of m[1].split(',')) { const [a, b] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/); if (a) exportedNames.add((b || a).trim()); }
  for (const m of code.matchAll(/(?<![\w$.])export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g)) exportedNames.add(m[1]);
  const defs = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(code))) {
    const isFnDecl = m[3] !== undefined;
    const nm = m[3] ?? m[4];
    const nameIdx = m.index + m[0].lastIndexOf(nm);
    let hashFrom; let end; let isFn;
    if (isFnDecl) {
      let j = skipWs(code, nameIdx + nm.length);
      if (code[j] === '<') { let d = 0; for (; j < code.length; j++) { if (code[j] === '<') d++; else if (code[j] === '>' && --d === 0) { j++; break; } } j = skipWs(code, j); }
      if (code[j] !== '(') continue;
      const close = matchClose(code, j);
      if (close < 0) continue;
      const body = bodyBrace(code, close + 1);
      if (body < 0) continue;
      const bodyEnd = matchClose(code, body);
      if (bodyEnd < 0) continue;
      hashFrom = j; end = bodyEnd + 1; isFn = true;
    } else {
      let j = skipWs(code, nameIdx + nm.length);
      if (code[j] === ':') { // type annotation up to the `=`
        let d = 0;
        for (j++; j < code.length; j++) {
          const ch = code[j];
          if ('([{<'.includes(ch)) d++; else if (')]}'.includes(ch)) d--;
          else if (ch === '>' && code[j - 1] !== '=') d--;
          else if (ch === ';' && d <= 0) { j = -1; break; }
          else if (ch === '=' && code[j + 1] !== '>' && code[j - 1] !== '=' && d <= 0) break;
        }
        if (j < 0 || j >= code.length) continue;
      }
      if (code[j] !== '=' || code[j + 1] === '=') continue;
      hashFrom = skipWs(code, j + 1);
      isFn = isFunctionExpr(code, hashFrom);
      end = statementEnd(code, hashFrom);
      while (end > hashFrom && (code[end - 1] === ';' || isSpace(code[end - 1]))) end--;
    }
    const exported = !!m[1] || exportedNames.has(nm);
    const line = lineAt(starts, nameIdx); const endLine = lineAt(starts, Math.max(nameIdx, end - 1));
    const startLine = lineAt(starts, m.index);
    let loc = 0;
    for (let L = startLine; L <= endLine; L++) if (/\S/.test(code.slice(starts[L - 1], starts[L] ?? code.length))) loc++;
    defs.push({
      name: nm, exported, isFn, line, col: nameIdx - starts[line - 1] + 1, startLine, endLine, loc, hashFrom, end,
      hash: isFn ? bodyHash((isFnDecl ? 'function ' : '') + noComments.slice(hashFrom, end)) : null,
      snippet: raw.slice(starts[startLine - 1], starts[Math.min(startLine + 4, starts.length - 1)] ?? raw.length).replace(/\s+$/, '').slice(0, 400),
    });
  }
  return { code, defs };
}

const typeDeclRe = (base) => new RegExp(`(?<![\\w$.])(?:export\\s+)?(?:declare\\s+)?(?:interface\\s+${base}\\b|type\\s+${base}\\s*(?:<[^=]*>)?\\s*=\\s*\\{)`);

async function readSource(root, file) {
  let raw; try { raw = await readFile(join(root, file), 'utf8'); } catch { return null; }
  if (raw.length > MAX_BYTES || raw.slice(0, 8000).includes('\0')) return null;
  if (hasGeneratedMarker(raw.slice(0, 400))) return null;
  if (SFC_EXT.test(file)) { const t = extractScripts(raw, extname(file)); return t; }
  return raw;
}

const relevantFile = (f) => !/\.d\.[cm]?ts$/.test(f) && !isGeneratedPath(f) && !isTestPath(f);

export async function run(ctx) {
  const { root, detect: d, rules, scope } = ctx;
  const packages = d.packages || [];
  const files = scope.files.filter(relevantFile);
  const byAdapter = (a) => rules.find((r) => r.adapter === a);
  const r07 = byAdapter('symbols:duplicate-utilities'); const r06 = byAdapter('symbols+importers:single-consumer'); const r03 = byAdapter('symbols:schema-dual');

  const info = new Map(); // file -> { code, defs, schemas, validator }
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(files.slice(i, i + CONCURRENCY).map(async (f) => {
      const raw = await readSource(root, f);
      if (raw === null) return;
      const { code, defs } = extractDefs(raw);
      info.set(f, { raw, code, defs, validator: VALIDATOR_IMPORT.test(blankComments(raw)) });
    }));
  }

  const out = [];
  const mk = (rule, f, def, extra) => ({
    rule: rule.id, domain: rule.domain, engine: extra.engine, package: packageOf(f, packages), file: f, line: def.line, col: def.col, symbol: extra.symbol ?? def.name, grain: rule.grain || 'symbol',
    snippet: def.snippet, raw_ref: extra.raw_ref, severity_hint: rule.severity, batch: rule.batch ?? null, wave: rule.wave ?? null, fix_mode_hint: rule.fix_mode, consumers: [], triage: rule.triage || 'agent',
    path_class: 'source', ...extra.more,
  });

  let idx = null;
  const index = async () => (idx ||= await buildImporterIndex({ root, files: scope.all_files, packages }));

  // struct-07: same catalogue name defined in >= 2 files of one package
  if (r07) {
    const groups = new Map(); // `${pkg}\0${name}` -> [{file, def}]
    for (const [f, fi] of info) {
      const seen = new Set();
      for (const def of fi.defs) {
        if (!def.isFn || !UTILITY_NAMES.has(def.name) || seen.has(def.name)) continue;
        seen.add(def.name);
        const k = `${packageOf(f, packages)}\0${def.name}`;
        (groups.get(k) || groups.set(k, []).get(k)).push({ file: f, def });
      }
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.file.localeCompare(b.file));
      const identical = new Set(list.map((x) => x.def.hash)).size === 1;
      const members = list.map((x) => `${x.file}:${x.def.line}`);
      const ix = await index();
      for (const { file, def } of list) {
        const c = mk(r07, file, def, {
          engine: 'symbols:duplicate-utilities', raw_ref: `body:${def.hash}`,
          more: { body_hash: def.hash, identical_bodies: identical, confidence_hint: identical ? 'certain' : 'likely', copies: members, tells: [identical ? 'identical-body' : 'diverging-body'] },
        });
        c.consumers = def.exported ? ix.consumersOfSymbol(file, def.name).filter((x) => x !== file) : [];
        out.push(c);
      }
    }
  }

  // struct-06: exported, < 25 LOC, under utils|helpers|shared|lib, exactly one importing file
  if (r06) {
    for (const [f, fi] of info) {
      if (!SHARED_DIR.test(posix.dirname(f) + '/')) continue;
      for (const def of fi.defs) {
        if (!def.exported || def.loc >= 25) continue;
        const ix = await index();
        const edges = (ix.importers.get(f) || []).filter((e) => e.from !== f && (e.star || e.names.includes(def.name) || (e.names.includes('default') && def.name === 'default')));
        if (edges.some((e) => e.reexport)) continue; // a barrel re-exports it: the real consumers are beyond the importer index
        const consumers = [...new Set(edges.map((e) => e.from))].sort();
        if (consumers.length !== 1 || isTestPath(consumers[0])) continue; // a test-only import is reach-03; two importers (tests count) is not single-consumer
        out.push(mk(r06, f, def, { engine: 'symbols:single-consumer', raw_ref: `loc:${def.loc}`, more: { loc: def.loc, tells: ['single-consumer'], consumers } }));
      }
    }
  }

  // type-03: `XSchema` validator + hand-written `interface X` / `type X = {` in one package, no inference reference
  if (r03) {
    const pairs = [];
    for (const [f, fi] of info) {
      if (!fi.validator) continue;
      for (const def of fi.defs) {
        const sm = /^([\w$]*?[\w$])Schema$/.exec(def.name);
        if (!sm || def.isFn) continue;
        const after = fi.code.slice(def.hashFrom, def.hashFrom + 160);
        if (!SCHEMA_BUILDER.test(after)) continue;
        const base = sm[1]; const pkg = packageOf(f, packages);
        const re = typeDeclRe(base);
        let decl = null;
        for (const [g, gi] of [...info].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (packageOf(g, packages) !== pkg) continue;
          const hit = re.exec(gi.code);
          if (hit) { decl = { file: g, line: lineAt(lineStarts(gi.code), hit.index + hit[0].search(/interface|type/)), name: base }; break; }
        }
        if (decl) pairs.push({ f, def, base, pkg, decl });
      }
    }
    if (pairs.length) {
      const needles = new Set(pairs.map((p) => p.def.name));
      const inferred = new Set(); // schema names referenced through an inference helper anywhere in the repo
      const refRe = /\b(?:infer|input|output|TypeOf|InferOutput|InferInput|InferType|Infer)\s*<\s*typeof\s+([\w$]+)|\btypeof\s+([\w$]+)\s*\.\s*infer(?:In)?\b/g;
      const all = scope.all_files.filter((f) => !/\.d\.[cm]?ts$/.test(f));
      for (let i = 0; i < all.length; i += CONCURRENCY) {
        await Promise.all(all.slice(i, i + CONCURRENCY).map(async (f) => {
          const cached = info.get(f);
          let raw = cached?.raw; if (raw === undefined) { raw = await readSource(root, f); if (raw === null) return; }
          if (!raw.includes('typeof')) return;
          const code = cached?.code ?? maskSource(raw).code;
          for (const m of code.matchAll(refRe)) { const nmv = m[1] || m[2]; if (needles.has(nmv)) inferred.add(nmv); }
        }));
      }
      const ix = await index();
      for (const p of pairs) {
        if (inferred.has(p.def.name)) continue;
        out.push(mk(r03, p.f, p.def, {
          engine: 'symbols:schema-dual', raw_ref: `${p.decl.file}:${p.decl.line}`,
          more: { tells: ['schema-type-dual'], type_decl: { file: p.decl.file, line: p.decl.line, name: p.base }, consumers: ix.consumersOfSymbol(p.decl.file, p.base).filter((x) => x !== p.f && x !== p.decl.file) },
        }));
      }
    }
  }

  out.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
  return { candidates: out, notes: { files_scanned: info.size } };
}
