// YAML subset: block maps/sequences, scalars, flow collections of scalars, block scalars, front matter.
// Not supported (clear error): anchors, aliases, tags, multi-document streams, directives.
// Zero dependencies. parseYaml throws; tryParseYaml never throws.

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    this.line = line || 0;
  }
}

function setKey(obj, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

const INT_RE = /^[-+]?(?:0|[1-9]\d*)$/;
const FLOAT_RE = /^[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/;

// Resolve a plain (unquoted) scalar to null/boolean/number/string.
function resolvePlain(s, line) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (INT_RE.test(s)) {
    const v = Number(s);
    return Number.isSafeInteger(v) || String(v) === s ? v : s;
  }
  if (/^[-+]?\d+$/.test(s)) return s; // leading zeros stay strings
  if (FLOAT_RE.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) ? v : s;
  }
  const c = s[0];
  if (c === '&') throw new YamlError('YAML anchors (&) are not supported', line);
  if (c === '*') throw new YamlError('YAML aliases (*) are not supported', line);
  if (c === '!') throw new YamlError('YAML tags (!) are not supported', line);
  if (c === '@' || c === '`') throw new YamlError(`Plain scalar cannot start with "${c}"`, line);
  if (/:(?:\s|$)/.test(s)) throw new YamlError('Mapping values are not allowed here (quote strings containing ": ")', line);
  return s;
}

// Parse a quoted scalar starting at s[pos]; returns {value, end} where end is the index after the closing quote.
function parseQuoted(s, pos, line) {
  const q = s[pos];
  let out = '';
  let i = pos + 1;
  if (q === "'") {
    for (;;) {
      if (i >= s.length) throw new YamlError('Unterminated single-quoted string', line);
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return { value: out, end: i + 1 };
      }
      out += s[i++];
    }
  }
  for (;;) {
    if (i >= s.length) throw new YamlError('Unterminated double-quoted string', line);
    const c = s[i];
    if (c === '"') return { value: out, end: i + 1 };
    if (c !== '\\') {
      out += c;
      i++;
      continue;
    }
    const e = s[i + 1];
    i += 2;
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'e': out += '\x1b'; break;
      case 'a': out += '\x07'; break;
      case 'v': out += '\v'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case ' ': out += ' '; break;
      case '_': out += '\u00A0'; break;
      case 'N': out += '\u0085'; break;
      case 'L': out += '\u2028'; break;
      case 'P': out += '\u2029'; break;
      case 'x':
      case 'u':
      case 'U': {
        const len = e === 'x' ? 2 : e === 'u' ? 4 : 8;
        const hex = s.slice(i, i + len);
        if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) throw new YamlError(`Invalid \\${e} escape`, line);
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff) throw new YamlError(`Invalid \\${e} escape`, line);
        out += String.fromCodePoint(cp);
        i += len;
        break;
      }
      default:
        throw new YamlError(`Unknown escape sequence \\${e === undefined ? '' : e}`, line);
    }
  }
}

// Remove a trailing "# comment" (quote aware) from a single line of text.
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") i++;
        else quote = null;
      }
    } else if (c === '"' || c === "'") {
      const prev = i === 0 ? ' ' : s[i - 1];
      if (/[\s[{,]/.test(prev)) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function flowDepth(s) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") i++;
        else quote = null;
      }
    } else if (c === '"' || c === "'") {
      const prev = i === 0 ? ' ' : s[i - 1];
      if (/[\s[{,:]/.test(prev)) quote = c;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return quote ? 1 : depth;
}

function parseFlow(str, line) {
  let p = 0;
  const ws = () => {
    while (p < str.length && /\s/.test(str[p])) p++;
  };
  const isQuote = (c) => c === '"' || c === "'";
  function plainUntil(isKey) {
    const start = p;
    while (p < str.length) {
      const c = str[p];
      if (c === ',' || c === ']' || c === '}' || c === '[' || c === '{') break;
      if (c === ':' && (p + 1 >= str.length || /[\s,\]}]/.test(str[p + 1]))) break;
      p++;
    }
    const raw = str.slice(start, p).trim();
    if (raw === '') throw new YamlError('Empty value in flow collection', line);
    return isKey ? raw : resolvePlain(raw, line);
  }
  function seq() {
    p++;
    const arr = [];
    for (;;) {
      ws();
      if (p >= str.length) throw new YamlError('Unterminated flow sequence', line);
      if (str[p] === ']') {
        p++;
        return arr;
      }
      arr.push(val());
      ws();
      if (str[p] === ',') p++;
      else if (str[p] === ']') {
        p++;
        return arr;
      } else if (str[p] === ':') throw new YamlError('Single-pair mappings inside flow sequences are not supported', line);
      else throw new YamlError('Expected "," or "]" in flow sequence', line);
    }
  }
  function map() {
    p++;
    const obj = {};
    for (;;) {
      ws();
      if (p >= str.length) throw new YamlError('Unterminated flow mapping', line);
      if (str[p] === '}') {
        p++;
        return obj;
      }
      let key;
      if (isQuote(str[p])) {
        const q = parseQuoted(str, p, line);
        key = q.value;
        p = q.end;
      } else if (str[p] === '[' || str[p] === '{') {
        throw new YamlError('Collection keys are not supported', line);
      } else key = plainUntil(true);
      ws();
      let v = null;
      if (str[p] === ':') {
        p++;
        ws();
        if (str[p] !== ',' && str[p] !== '}') v = val();
      }
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new YamlError(`Duplicate key "${key}"`, line);
      setKey(obj, key, v);
      ws();
      if (str[p] === ',') p++;
      else if (str[p] === '}') {
        p++;
        return obj;
      } else throw new YamlError('Expected "," or "}" in flow mapping', line);
    }
  }
  function val() {
    ws();
    const c = str[p];
    if (c === '[') return seq();
    if (c === '{') return map();
    if (isQuote(c)) {
      const q = parseQuoted(str, p, line);
      p = q.end;
      return q.value;
    }
    return plainUntil(false);
  }
  const v = val();
  ws();
  if (p < str.length) throw new YamlError(`Unexpected text after flow collection: ${str.slice(p, p + 20)}`, line);
  return v;
}

export function parseYaml(input) {
  if (typeof input !== 'string') throw new TypeError('YAML input must be a string');
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  text = text.replace(/\r\n?/g, '\n');
  if (/^%/m.test(text) && /^%(YAML|TAG)/m.test(text)) throw new YamlError('YAML directives are not supported');
  const lines = text.split('\n').map((raw, k) => {
    const indent = /^ */.exec(raw)[0].length;
    return { indent, text: raw.slice(indent), no: k + 1, parent: undefined };
  });
  const len = lines.length;
  let i = 0;

  const skippable = (l) => {
    const t = l.text.trim();
    return t === '' || t[0] === '#';
  };
  function skip() {
    while (i < len && skippable(lines[i])) i++;
    if (i < len) {
      const l = lines[i];
      if (l.indent === 0 && l.parent === undefined) {
        if (/^\.\.\.(\s|$)/.test(l.text)) i = len;
        else if (/^---(\s|$)/.test(l.text)) throw new YamlError('Multi-document YAML is not supported', l.no);
      }
    }
  }
  function clean(l) {
    if (l.text[0] === '\t') throw new YamlError('Tabs are not allowed for indentation', l.no);
    return stripComment(l.text).trimEnd();
  }
  const SEQ_RE = /^-(\s|$)/;

  function tryKey(t, no) {
    const c = t[0];
    if (c === '"' || c === "'") {
      const q = parseQuoted(t, 0, no);
      let j = q.end;
      while (t[j] === ' ') j++;
      if (t[j] === ':' && (j + 1 >= t.length || t[j + 1] === ' ')) {
        return { key: q.value, rest: t.slice(j + 1).trim() };
      }
      return null;
    }
    if (c === '[' || c === '{') return null;
    const m = /:(?:\s|$)/.exec(t);
    if (!m) return null;
    const key = t.slice(0, m.index).trim();
    if (key === '') throw new YamlError('Empty mapping key', no);
    return { key, rest: t.slice(m.index + 1).trim() };
  }

  function blockScalar(header, parentIndent, no) {
    const m = /^([|>])([+-]?)(\d?)([+-]?)$/.exec(header);
    if (!m) throw new YamlError(`Invalid block scalar header "${header}"`, no);
    const folded = m[1] === '>';
    const sign = m[2] || m[4];
    const chomp = sign === '-' ? 'strip' : sign === '+' ? 'keep' : 'clip';
    let blockIndent = -1;
    if (m[3]) blockIndent = Math.max(parentIndent, 0) + Number(m[3]);
    else {
      for (let j = i; j < len; j++) {
        if (lines[j].text.trim() !== '') {
          blockIndent = lines[j].indent;
          break;
        }
      }
    }
    const body = [];
    if (blockIndent > parentIndent) {
      while (i < len) {
        const l = lines[i];
        if (l.text.trim() === '') body.push('');
        else if (l.indent < blockIndent) break;
        else body.push(' '.repeat(l.indent - blockIndent) + l.text);
        i++;
      }
    }
    let end = body.length;
    while (end > 0 && body[end - 1] === '') end--;
    const content = body.slice(0, end);
    const trailing = body.length - end;
    let out;
    if (!folded) out = content.join('\n');
    else {
      out = '';
      for (let k = 0; k < content.length; k++) {
        const line = content[k];
        if (k === 0) out = line;
        else if (line === '') out += '\n';
        else {
          const prev = content[k - 1];
          if (prev === '') out += line[0] === ' ' ? '\n' + line : line;
          else out += (prev[0] === ' ' || line[0] === ' ' ? '\n' : ' ') + line;
        }
      }
    }
    if (chomp === 'strip') return out;
    if (chomp === 'keep') return content.length ? out + '\n'.repeat(1 + trailing) : '\n'.repeat(trailing);
    return content.length ? out + '\n' : '';
  }

  function gatherFlow(first, no) {
    let acc = first;
    while (flowDepth(acc) > 0) {
      if (i >= len) throw new YamlError('Unterminated flow collection', no);
      const l = lines[i++];
      if (skippable(l)) continue;
      acc += ' ' + stripComment(l.text).trim();
    }
    return acc;
  }

  // Parse the value found after "key:" or "-" given the rest of the line (the line itself is already consumed).
  function parseValue(rest, parentIndent, no, allowSameIndentSeq) {
    if (rest === '') {
      skip();
      if (i < len) {
        const nl = lines[i];
        if (nl.indent > parentIndent) return parseNode();
        if (allowSameIndentSeq && nl.indent === parentIndent && SEQ_RE.test(clean(nl))) return parseSeq(parentIndent);
      }
      return null;
    }
    const c = rest[0];
    if (c === '|' || c === '>') return blockScalar(rest, parentIndent, no);
    if (c === '[' || c === '{') return parseFlow(gatherFlow(rest, no), no);
    if (c === '"' || c === "'") {
      const q = parseQuoted(rest, 0, no);
      if (rest.slice(q.end).trim() !== '') throw new YamlError('Unexpected text after quoted scalar', no);
      return q.value;
    }
    return resolvePlain(rest, no);
  }

  function parseSeq(ind) {
    const arr = [];
    for (;;) {
      skip();
      if (i >= len) break;
      const l = lines[i];
      if (l.indent < ind) break;
      if (l.indent > ind) throw new YamlError('Bad indentation of a sequence entry', l.no);
      const t = clean(l);
      if (!SEQ_RE.test(t)) break;
      const afterDash = l.text.slice(1);
      const lead = afterDash.length - afterDash.trimStart().length;
      if (t.slice(1).trim() === '') {
        i++;
        skip();
        arr.push(i < len && lines[i].indent > ind ? parseNode() : null);
        continue;
      }
      lines[i] = { indent: l.indent + 1 + lead, text: afterDash.slice(lead), no: l.no, parent: ind };
      arr.push(parseNode());
    }
    return arr;
  }

  function parseMap(ind) {
    const obj = {};
    for (;;) {
      skip();
      if (i >= len) break;
      const l = lines[i];
      if (l.indent < ind) break;
      if (l.indent > ind) throw new YamlError('Bad indentation of a mapping entry', l.no);
      const t = clean(l);
      if (SEQ_RE.test(t)) break;
      const k = tryKey(t, l.no);
      if (!k) throw new YamlError(`Expected "key: value" but found "${t.slice(0, 30)}"`, l.no);
      if (Object.prototype.hasOwnProperty.call(obj, k.key)) throw new YamlError(`Duplicate key "${k.key}"`, l.no);
      i++;
      setKey(obj, k.key, parseValue(k.rest, ind, l.no, true));
    }
    return obj;
  }

  function parseNode() {
    skip();
    if (i >= len) return null;
    const l = lines[i];
    const t = clean(l);
    if (SEQ_RE.test(t)) return parseSeq(l.indent);
    if (tryKey(t, l.no)) return parseMap(l.indent);
    i++;
    return parseValue(t, l.parent !== undefined ? l.parent : l.indent - 1, l.no, false);
  }

  // Optional leading "---".
  while (i < len && skippable(lines[i])) i++;
  if (i < len && lines[i].indent === 0 && /^---(\s|$)/.test(lines[i].text)) {
    const rest = stripComment(lines[i].text.slice(3)).trim();
    if (rest === '') i++;
    else lines[i] = { indent: 4, text: rest, no: lines[i].no, parent: -1 };
  }
  skip();
  if (i >= len) return null;
  const result = parseNode();
  skip();
  if (i < len) throw new YamlError('Unexpected content (bad indentation?)', lines[i].no);
  return result;
}

export function tryParseYaml(text) {
  try {
    return { ok: true, value: parseYaml(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
}

// ---------------------------------------------------------------- stringify

const SIMPLE_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

function dq(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 || c === 0x85) {
      out += '\\u' + c.toString(16).padStart(4, '0');
    } else out += ch;
  }
  return out + '"';
}

function needsQuotes(s) {
  if (s === '') return true;
  if (s !== s.trim()) return true;
  if (/[:#]/.test(s)) return true;
  if (/^[-?,[\]{}&*!|>'"%@`]/.test(s)) return true;
  if (/[\x00-\x1f\x7f\u0085\u2028\u2029]/.test(s)) return true;
  try {
    return typeof resolvePlain(s, 0) !== 'string';
  } catch {
    return true;
  }
}

function scalarText(v, key, regexKeys) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('Cannot stringify non-finite number');
    return String(v);
  }
  if (typeof v === 'string') {
    if (key !== undefined && regexKeys.has(key) && !/[\x00-\x1f\x7f\u2028\u2029\u0085]/.test(v)) {
      return "'" + v.replace(/'/g, "''") + "'";
    }
    return needsQuotes(v) ? dq(v) : v;
  }
  throw new TypeError(`Cannot stringify value of type ${typeof v}`);
}

function keyText(k) {
  return SIMPLE_KEY_RE.test(k) ? k : dq(k);
}

export function stringifyYaml(value, opts = {}) {
  const keyOrder = Array.isArray(opts.keyOrder) ? opts.keyOrder : [];
  const regexKeys = new Set(Array.isArray(opts.regexKeys) ? opts.regexKeys : []);
  const orderKeys = (obj) => {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const first = keyOrder.filter((k) => keys.includes(k));
    return first.concat(keys.filter((k) => !first.includes(k)));
  };
  const isColl = (v) => v !== null && typeof v === 'object';
  const isEmptyColl = (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).filter((k) => v[k] !== undefined).length === 0);

  // Returns lines (already indented by `ind` spaces) for a collection.
  function block(v, ind, parentKey) {
    const pad = ' '.repeat(ind);
    const out = [];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isColl(item) && !isEmptyColl(item)) {
          const sub = block(item, ind + 2, parentKey);
          sub[0] = pad + '- ' + sub[0].slice(ind + 2);
          out.push(...sub);
        } else {
          out.push(pad + '- ' + (isColl(item) ? (Array.isArray(item) ? '[]' : '{}') : scalarText(item, parentKey, regexKeys)));
        }
      }
      return out;
    }
    for (const k of orderKeys(v)) {
      const item = v[k];
      if (isColl(item) && !isEmptyColl(item)) {
        out.push(pad + keyText(k) + ':');
        out.push(...block(item, ind + 2, k));
      } else {
        out.push(pad + keyText(k) + ': ' + (isColl(item) ? (Array.isArray(item) ? '[]' : '{}') : scalarText(item, k, regexKeys)));
      }
    }
    return out;
  }

  if (!isColl(value)) return scalarText(value, undefined, regexKeys) + '\n';
  if (isEmptyColl(value)) return (Array.isArray(value) ? '[]' : '{}') + '\n';
  return block(value, 0, undefined).join('\n') + '\n';
}

// ---------------------------------------------------------------- front matter

export function splitFrontMatter(input) {
  if (typeof input !== 'string') throw new TypeError('Front matter input must be a string');
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  text = text.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!/^---[ \t]*$/.test(lines[0])) return { data: {}, body: text, hasFrontMatter: false };
  let end = -1;
  for (let k = 1; k < lines.length; k++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[k])) {
      end = k;
      break;
    }
  }
  if (end === -1) throw new YamlError('Unterminated front matter (missing closing "---")');
  const parsed = parseYaml(lines.slice(1, end).join('\n'));
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new YamlError('Front matter must be a mapping');
  }
  return { data: parsed === null ? {} : parsed, body: lines.slice(end + 1).join('\n'), hasFrontMatter: true };
}

export function trySplitFrontMatter(text) {
  try {
    return { ok: true, ...splitFrontMatter(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
}
