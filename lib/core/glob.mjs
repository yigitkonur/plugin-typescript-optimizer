// Mini-glob over "/"-normalised relative paths. Zero dependencies.
// Supports * ** ? {a,b} (nested) [abc] [!abc], leading "./" ignored, trailing "/".
// Backslash in a pattern is an escape; paths (not patterns) are converted with toPosix. A trailing "/" on a pattern or path is ignored.

export function toPosix(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
}

function normPath(p, isPattern = false) {
  let s = isPattern ? p : toPosix(p);
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s;
}

// Expand {a,b} alternatives (nested ok) into a list of brace-free patterns.
function expandBraces(pat, budget = { left: 1024 }) {
  let inClass = false;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '\\') {
      i++;
    } else if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[' && pat.indexOf(']', i + 2) !== -1) {
      inClass = true;
    } else if (c === '{') {
      let depth = 0;
      let j = i;
      const parts = [];
      let from = i + 1;
      let closed = -1;
      let cls = false;
      for (; j < pat.length; j++) {
        const d = pat[j];
        if (d === '\\') j++;
        else if (cls) {
          if (d === ']') cls = false;
        } else if (d === '[' && pat.indexOf(']', j + 2) !== -1) cls = true;
        else if (d === '{') depth++;
        else if (d === '}') {
          depth--;
          if (depth === 0) {
            parts.push(pat.slice(from, j));
            closed = j;
            break;
          }
        } else if (d === ',' && depth === 1) {
          parts.push(pat.slice(from, j));
          from = j + 1;
        }
      }
      if (closed === -1 || parts.length < 2) continue; // literal brace
      const pre = pat.slice(0, i);
      const post = pat.slice(closed + 1);
      const out = [];
      for (const part of parts) {
        for (const e of expandBraces(pre + part + post, budget)) {
          if (budget.left-- <= 0) return out;
          out.push(e);
        }
      }
      return out;
    }
  }
  return [pat];
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\/]/g;
const esc = (s) => s.replace(RE_SPECIAL, '\\$&');

function segmentToRegex(seg, dot) {
  if (/^\*+$/.test(seg)) return dot ? '[^/]+' : '(?!\\.)[^/]+';
  let out = '';
  if (!dot && seg[0] !== '.') out += '(?!\\.)';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '\\' && i + 1 < seg.length) {
      out += esc(seg[++i]);
    } else if (c === '*') {
      while (seg[i + 1] === '*') i++;
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const close = seg.indexOf(']', i + 2);
      if (close === -1) {
        out += '\\[';
        continue;
      }
      let body = seg.slice(i + 1, close);
      let neg = false;
      if (body[0] === '!' || body[0] === '^') {
        neg = true;
        body = body.slice(1);
      }
      body = body.replace(/[\\\]^[]/g, '\\$&');
      out += '[' + (neg ? '^/' : '') + body + ']';
      i = close;
    } else {
      out += esc(c);
    }
  }
  return out;
}

function compileOne(pattern, dot) {
  const segs = pattern.split('/');
  const SEG = dot ? '[^/]+' : '(?!\\.)[^/]+';
  let out = '';
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    const last = k === segs.length - 1;
    if (seg === '**') {
      if (last) out += k === 0 ? `(?:${SEG}(?:/${SEG})*)?` : `(?:/${SEG})*`;
      else out += `(?:${SEG}/)*`;
      continue;
    }
    out += segmentToRegex(seg, dot);
    if (!last) out += segs[k + 1] === '**' && k + 1 === segs.length - 1 ? '' : '/';
  }
  return out;
}

export function compileGlob(pattern, opts = {}) {
  const dot = !!(opts && opts.dot);
  const pat = normPath(typeof pattern === 'string' ? pattern : '', true);
  if (pat === '') return /^$/;
  const alts = expandBraces(pat).map((a) => compileOne(a, dot));
  return new RegExp('^(?:' + alts.join('|') + ')$');
}

export function matchGlob(pattern, path, opts) {
  if (typeof path !== 'string') return false;
  return compileGlob(pattern, opts).test(normPath(path));
}

// Workspace semantics: patterns applied in order, "!pattern" removes earlier matches. Result sorted and de-duplicated.
export function filterGlobs(paths, patterns, opts) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string').map(normPath);
  const selected = new Set();
  for (const raw of Array.isArray(patterns) ? patterns : []) {
    if (typeof raw !== 'string') continue;
    const negated = raw.startsWith('!');
    const re = compileGlob(negated ? raw.slice(1) : raw, opts);
    for (const p of list) {
      if (!re.test(p)) continue;
      if (negated) selected.delete(p);
      else selected.add(p);
    }
  }
  return [...selected].sort();
}
