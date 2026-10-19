// JSONC parser (tsconfig.json, wrangler.jsonc, package.json): comments, trailing commas, BOM.
// Zero dependencies. parseJsonc throws; tryParseJsonc never throws.

const MAX_DEPTH = 512;
const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function locate(text, offset) {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

function makeError(text, message, offset) {
  const { line, column } = locate(text, offset);
  const e = new Error(`${message} at line ${line}, column ${column}`);
  e.name = 'JsoncError';
  e.offset = offset;
  e.line = line;
  e.column = column;
  return e;
}

function setKey(obj, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

export function parseJsonc(text) {
  if (typeof text !== 'string') {
    const e = new TypeError('JSONC input must be a string');
    e.offset = 0;
    e.line = 1;
    e.column = 1;
    throw e;
  }
  let p = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const fail = (msg, at = p) => {
    throw makeError(text, msg, at);
  };

  function skip() {
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029) {
        p++;
      } else if (c === 47) {
        const d = text.charCodeAt(p + 1);
        if (d === 47) {
          p += 2;
          while (p < n && text.charCodeAt(p) !== 10 && text.charCodeAt(p) !== 13) p++;
        } else if (d === 42) {
          const end = text.indexOf('*/', p + 2);
          if (end === -1) fail('Unterminated comment');
          p = end + 2;
        } else {
          return;
        }
      } else {
        return;
      }
    }
  }

  function string() {
    const start = p;
    p++;
    let out = '';
    let chunk = p;
    for (;;) {
      if (p >= n) fail('Unterminated string', start);
      const c = text.charCodeAt(p);
      if (c === 34) {
        out += text.slice(chunk, p);
        p++;
        return out;
      }
      if (c === 10 || c === 13) fail('Unterminated string', start);
      if (c === 92) {
        out += text.slice(chunk, p);
        const e = text[p + 1];
        p += 2;
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = text.slice(p, p + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape', p - 2);
            out += String.fromCharCode(parseInt(hex, 16));
            p += 4;
            break;
          }
          default:
            fail('Invalid escape sequence', p - 2);
        }
        chunk = p;
      } else {
        p++;
      }
    }
  }

  function value(depth) {
    skip();
    if (p >= n) fail('Unexpected end of input');
    const c = text[p];
    if (c === '{') {
      if (depth >= MAX_DEPTH) fail(`Nesting deeper than ${MAX_DEPTH} levels`);
      p++;
      const obj = {};
      for (;;) {
        skip();
        if (p >= n) fail('Unterminated object');
        if (text[p] === '}') {
          p++;
          return obj;
        }
        if (text[p] !== '"') fail('Expected string key');
        const key = string();
        skip();
        if (text[p] !== ':') fail("Expected ':' after key");
        p++;
        setKey(obj, key, value(depth + 1));
        skip();
        if (text[p] === ',') {
          p++;
        } else if (text[p] === '}') {
          p++;
          return obj;
        } else {
          fail(p >= n ? 'Unterminated object' : "Expected ',' or '}'");
        }
      }
    }
    if (c === '[') {
      if (depth >= MAX_DEPTH) fail(`Nesting deeper than ${MAX_DEPTH} levels`);
      p++;
      const arr = [];
      for (;;) {
        skip();
        if (p >= n) fail('Unterminated array');
        if (text[p] === ']') {
          p++;
          return arr;
        }
        arr.push(value(depth + 1));
        skip();
        if (text[p] === ',') {
          p++;
        } else if (text[p] === ']') {
          p++;
          return arr;
        } else {
          fail(p >= n ? 'Unterminated array' : "Expected ',' or ']'");
        }
      }
    }
    if (c === '"') return string();
    if (text.startsWith('true', p)) { p += 4; return true; }
    if (text.startsWith('false', p)) { p += 5; return false; }
    if (text.startsWith('null', p)) { p += 4; return null; }
    NUM_RE.lastIndex = p;
    const m = NUM_RE.exec(text);
    if (m) {
      p += m[0].length;
      return Number(m[0]);
    }
    return fail(`Unexpected character ${JSON.stringify(c)}`);
  }

  skip();
  if (p >= n) fail('Empty input');
  const result = value(0);
  skip();
  if (p < n) fail('Unexpected content after JSON value');
  return result;
}

export function tryParseJsonc(text) {
  try {
    return { ok: true, value: parseJsonc(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
}

function blank(s) {
  return s.replace(/[^\r\n]/g, ' ');
}

// Index just past whitespace and comments starting at j.
function skipTrivia(text, j) {
  const n = text.length;
  while (j < n) {
    const c = text[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      j++;
    } else if (c === '/' && text[j + 1] === '/') {
      while (j < n && text[j] !== '\n') j++;
    } else if (c === '/' && text[j + 1] === '*') {
      const end = text.indexOf('*/', j + 2);
      if (end === -1) return n;
      j = end + 2;
    } else {
      break;
    }
  }
  return j;
}

// Removes comments, trailing commas and the BOM, replacing them with spaces so offsets are unchanged.
export function stripJsonc(text) {
  if (typeof text !== 'string') return '';
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\uFEFF') {
      out += ' ';
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      if (text[j] === '"') j++;
      j = Math.min(j, n);
      out += text.slice(i, j);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      out += blank(text.slice(i, j));
      i = j;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      out += blank(text.slice(i, j));
      i = j;
    } else if (c === ',') {
      const k = skipTrivia(text, i + 1);
      out += text[k] === '}' || text[k] === ']' ? ' ' : ',';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
