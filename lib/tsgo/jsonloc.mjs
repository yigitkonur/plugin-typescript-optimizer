// JSONC reader that keeps source positions: every property of every object records the line/column of its KEY.
// lib/core/jsonc.mjs returns plain values; fit needs "tsconfig.json:7" for each option, so this walks the
// comment-stripped text (stripJsonc preserves offsets) with a small recursive-descent reader. Never throws.
import { stripJsonc } from '../core/jsonc.mjs';

/**
 * parseLocated(text) -> node | null
 * node = { type: 'object'|'array'|'string'|'number'|'boolean'|'null'|'unknown', value, line, col, props: Map<key,{key,line,col,node}>|null, items: node[]|null }
 * `value` is the JS value for scalars; use toValue(node) for objects/arrays.
 */
export function parseLocated(text) {
  if (typeof text !== 'string') return null;
  const s = stripJsonc(text);
  const n = s.length;
  const starts = [0];
  for (let i = 0; i < n; i++) if (s.charCodeAt(i) === 10) starts.push(i + 1);
  const pos = (off) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: off - starts[lo] + 1 };
  };
  let p = 0;
  const ws = () => { while (p < n && /\s/.test(s[p])) p++; };
  const readString = () => {
    let out = '';
    p++; // opening quote
    while (p < n && s[p] !== '"') {
      if (s[p] === '\\') {
        const c = s[p + 1];
        if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(p + 2, p + 6))) { out += String.fromCharCode(parseInt(s.slice(p + 2, p + 6), 16)); p += 6; }
        else { out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[c] ?? c ?? ''; p += 2; }
      } else out += s[p++];
    }
    p++; // closing quote
    return out;
  };
  let depth = 0;
  const readValue = () => {
    ws();
    const at = pos(p);
    const c = s[p];
    if (c === undefined) throw new Error('eof');
    if (depth > 64) throw new Error('too deep');
    if (c === '{') {
      depth++; p++;
      const props = new Map();
      for (;;) {
        ws();
        if (s[p] === '}') { p++; break; }
        if (s[p] !== '"') throw new Error('key expected');
        const kpos = pos(p);
        const key = readString();
        ws();
        if (s[p] !== ':') throw new Error('colon expected');
        p++;
        const node = readValue();
        if (!props.has(key)) props.set(key, { key, line: kpos.line, col: kpos.col, node });
        ws();
        if (s[p] === ',') p++;
        else if (s[p] !== '}') throw new Error('} expected');
      }
      depth--;
      return { type: 'object', value: undefined, ...at, props, items: null };
    }
    if (c === '[') {
      depth++; p++;
      const items = [];
      for (;;) {
        ws();
        if (s[p] === ']') { p++; break; }
        items.push(readValue());
        ws();
        if (s[p] === ',') p++;
        else if (s[p] !== ']') throw new Error('] expected');
      }
      depth--;
      return { type: 'array', value: undefined, ...at, props: null, items };
    }
    if (c === '"') return { type: 'string', value: readString(), ...at, props: null, items: null };
    const m = /^[^\s,\]}]+/.exec(s.slice(p, p + 64));
    if (!m) throw new Error('value expected');
    p += m[0].length;
    if (m[0] === 'true' || m[0] === 'false') return { type: 'boolean', value: m[0] === 'true', ...at, props: null, items: null };
    if (m[0] === 'null') return { type: 'null', value: null, ...at, props: null, items: null };
    const num = Number(m[0]);
    if (Number.isFinite(num)) return { type: 'number', value: num, ...at, props: null, items: null };
    return { type: 'unknown', value: m[0], ...at, props: null, items: null };
  };
  try {
    const root = readValue();
    return root;
  } catch {
    return null;
  }
}

/** node -> plain JS value */
export function toValue(node) {
  if (!node) return undefined;
  if (node.type === 'object') { const o = {}; for (const [k, v] of node.props) Object.defineProperty(o, k, { value: toValue(v.node), enumerable: true, writable: true, configurable: true }); return o; }
  if (node.type === 'array') return node.items.map(toValue);
  return node.value;
}

/** the property record `{key,line,col,node}` of an object node, or null */
export function prop(node, key) {
  return node && node.type === 'object' ? node.props.get(key) || null : null;
}

/** text of 1-based `line` (trimmed, capped) */
export function lineText(text, line, max = 300) {
  const l = String(text).split(/\r?\n/)[line - 1];
  return l === undefined ? '' : l.trim().slice(0, max);
}
