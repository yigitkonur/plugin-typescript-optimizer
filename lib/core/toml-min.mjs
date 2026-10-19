// Minimal TOML parser (wrangler.toml and similar). Datetimes are returned as strings.
// Zero dependencies. parseToml throws; tryParseToml never throws.

export class TomlError extends Error {
  constructor(message, line, column) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'TomlError';
    this.line = line;
    this.column = column;
  }
}

function setKey(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const DATETIME_RE = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\', e: '\x1b' };

export function parseToml(input) {
  if (typeof input !== 'string') throw new TypeError('TOML input must be a string');
  const text = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).replace(/\r\n/g, '\n');
  const n = text.length;
  let p = 0;

  const fail = (msg, at = p) => {
    let line = 1;
    let last = -1;
    for (let k = 0; k < Math.min(at, n); k++) {
      if (text.charCodeAt(k) === 10) {
        line++;
        last = k;
      }
    }
    throw new TomlError(msg, line, at - last);
  };

  const skipSpaces = () => {
    while (p < n && (text[p] === ' ' || text[p] === '\t')) p++;
  };
  const skipComment = () => {
    if (text[p] === '#') while (p < n && text[p] !== '\n') p++;
  };
  // whitespace, comments and newlines
  const skipAll = () => {
    for (;;) {
      skipSpaces();
      if (text[p] === '#') skipComment();
      else if (text[p] === '\n') p++;
      else return;
    }
  };

  function unicode(len) {
    const hex = text.slice(p, p + len);
    if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) fail('Invalid unicode escape');
    const cp = parseInt(hex, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail('Invalid unicode scalar value');
    p += len;
    return String.fromCodePoint(cp);
  }

  function basicString(multiline) {
    const start = p;
    p += multiline ? 3 : 1;
    if (multiline && text[p] === '\n') p++;
    let out = '';
    for (;;) {
      if (p >= n) fail('Unterminated string', start);
      const c = text[p];
      if (multiline) {
        if (c === '"' && text.startsWith('"""', p)) {
          let extra = 0;
          while (text[p + 3 + extra] === '"' && extra < 2) extra++;
          out += '"'.repeat(extra);
          p += 3 + extra;
          return out;
        }
      } else {
        if (c === '"') {
          p++;
          return out;
        }
        if (c === '\n') fail('Unterminated string', start);
      }
      if (c === '\\') {
        p++;
        const e = text[p];
        if (e === 'u') {
          p++;
          out += unicode(4);
        } else if (e === 'U') {
          p++;
          out += unicode(8);
        } else if (e === 'x') {
          p++;
          out += unicode(2);
        } else if (multiline && /[ \t\n]/.test(e || '')) {
          let q = p;
          while (text[q] === ' ' || text[q] === '\t') q++;
          if (text[q] !== '\n') fail('Invalid line-ending backslash');
          while (q < n && /[ \t\n]/.test(text[q])) q++;
          p = q;
        } else if (e !== undefined && has(ESCAPES, e)) {
          out += ESCAPES[e];
          p++;
        } else fail('Invalid escape sequence');
      } else {
        out += c;
        p++;
      }
    }
  }

  function literalString(multiline) {
    const start = p;
    p += multiline ? 3 : 1;
    if (multiline && text[p] === '\n') p++;
    if (multiline) {
      const end = text.indexOf("'''", p);
      if (end === -1) fail('Unterminated string', start);
      let stop = end;
      while (text[stop + 3] === "'" && stop - end < 2) stop++;
      const out = text.slice(p, stop);
      p = stop + 3;
      return out;
    }
    const end = text.indexOf("'", p);
    const nl = text.indexOf('\n', p);
    if (end === -1 || (nl !== -1 && nl < end)) fail('Unterminated string', start);
    const out = text.slice(p, end);
    p = end + 1;
    return out;
  }

  function keyPart() {
    skipSpaces();
    const c = text[p];
    if (c === '"') return basicString(false);
    if (c === "'") return literalString(false);
    const m = /^[A-Za-z0-9_-]+/.exec(text.slice(p, p + 256));
    if (!m) fail('Expected a key');
    p += m[0].length;
    return m[0];
  }

  function keyPath() {
    const parts = [keyPart()];
    for (;;) {
      skipSpaces();
      if (text[p] !== '.') return parts;
      p++;
      parts.push(keyPart());
    }
  }

  function value() {
    skipSpaces();
    const c = text[p];
    if (c === undefined || c === '\n') fail('Expected a value');
    if (c === '"') return text.startsWith('"""', p) ? basicString(true) : basicString(false);
    if (c === "'") return text.startsWith("'''", p) ? literalString(true) : literalString(false);
    if (c === '[') return array();
    if (c === '{') return inlineTable();
    const m = /^[^\s,\]}#]+(?: \d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/.exec(text.slice(p, p + 128));
    if (!m) fail('Expected a value');
    const tok = m[0];
    const start = p;
    p += tok.length;
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (DATETIME_RE.test(tok)) return tok;
    if (tok === 'inf' || tok === '+inf') return Infinity;
    if (tok === '-inf') return -Infinity;
    if (tok === 'nan' || tok === '+nan' || tok === '-nan') return NaN;
    if (/^[+-]?(?:0|[1-9](?:_?\d)*)$/.test(tok)) return Number(tok.replace(/_/g, ''));
    if (/^0x[0-9a-fA-F](?:_?[0-9a-fA-F])*$/.test(tok)) return parseInt(tok.slice(2).replace(/_/g, ''), 16);
    if (/^0o[0-7](?:_?[0-7])*$/.test(tok)) return parseInt(tok.slice(2).replace(/_/g, ''), 8);
    if (/^0b[01](?:_?[01])*$/.test(tok)) return parseInt(tok.slice(2).replace(/_/g, ''), 2);
    if (/^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(tok)) {
      return Number(tok.replace(/_/g, ''));
    }
    return fail(`Invalid value "${tok.slice(0, 30)}"`, start);
  }

  function array() {
    p++;
    const arr = [];
    for (;;) {
      skipAll();
      if (p >= n) fail('Unterminated array');
      if (text[p] === ']') {
        p++;
        return arr;
      }
      arr.push(value());
      skipAll();
      if (p >= n) fail('Unterminated array');
      if (text[p] === ',') p++;
      else if (text[p] === ']') {
        p++;
        return arr;
      } else fail("Expected ',' or ']' in array");
    }
  }

  function inlineTable() {
    p++;
    const obj = {};
    skipAll();
    if (text[p] === '}') {
      p++;
      return obj;
    }
    for (;;) {
      skipAll();
      assign(obj, keyPath(), () => {
        skipSpaces();
        if (text[p] !== '=') fail("Expected '='");
        p++;
        return value();
      });
      skipAll();
      if (text[p] === ',') {
        p++;
        skipAll();
        if (text[p] === '}') fail('Trailing comma in inline table');
      } else if (text[p] === '}') {
        p++;
        return obj;
      } else fail("Expected ',' or '}' in inline table");
    }
  }

  // Descend into parts (creating tables); arrays of tables resolve to their last element.
  function descend(base, parts) {
    let cur = base;
    for (const part of parts) {
      if (!has(cur, part)) setKey(cur, part, {});
      let next = cur[part];
      if (Array.isArray(next)) {
        next = next[next.length - 1];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) fail(`Key "${part}" is not a table`);
      } else if (next === null || typeof next !== 'object') fail(`Key "${part}" is not a table`);
      else if (sealed.has(next)) fail(`Cannot extend inline table "${part}"`);
      cur = next;
    }
    return cur;
  }

  function assign(base, parts, getValue) {
    const at = p;
    const parent = descend(base, parts.slice(0, -1));
    const last = parts[parts.length - 1];
    if (has(parent, last)) fail(`Duplicate key "${last}"`, at);
    const v = getValue();
    if (v !== null && typeof v === 'object') sealed.add(v);
    setKey(parent, last, v);
  }

  const root = {};
  const sealed = new WeakSet(); // inline tables / static arrays
  const defined = new WeakSet(); // tables explicitly defined with a header
  let current = root;

  skipAll();
  while (p < n) {
    if (text[p] === '[') {
      const isArr = text[p + 1] === '[';
      p += isArr ? 2 : 1;
      const parts = keyPath();
      skipSpaces();
      if (isArr) {
        if (text[p] !== ']' || text[p + 1] !== ']') fail("Expected ']]'");
        p += 2;
      } else {
        if (text[p] !== ']') fail("Expected ']'");
        p++;
      }
      const parent = descend(root, parts.slice(0, -1));
      const last = parts[parts.length - 1];
      if (isArr) {
        if (!has(parent, last)) setKey(parent, last, []);
        const arr = parent[last];
        if (!Array.isArray(arr) || sealed.has(arr)) fail(`Key "${last}" is not an array of tables`);
        const t = {};
        arr.push(t);
        current = t;
      } else {
        if (!has(parent, last)) setKey(parent, last, {});
        const t = parent[last];
        if (t === null || typeof t !== 'object' || Array.isArray(t) || sealed.has(t)) fail(`Key "${last}" is not a table`);
        if (defined.has(t)) fail(`Table [${parts.join('.')}] defined more than once`);
        defined.add(t);
        current = t;
      }
    } else {
      assign(current, keyPath(), () => {
        skipSpaces();
        if (text[p] !== '=') fail("Expected '=' after key");
        p++;
        return value();
      });
    }
    skipSpaces();
    skipComment();
    if (p < n && text[p] !== '\n') fail('Unexpected content after value');
    skipAll();
  }
  return root;
}

export function tryParseToml(text) {
  try {
    return { ok: true, value: parseToml(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
}
