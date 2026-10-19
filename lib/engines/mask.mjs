// Source masking for the tier-1 regex engine: blank comments and string contents (scan: code),
// or everything but comments (scan: comments), preserving offsets and line breaks.
const REGEX_PREV = new Set('([{,;:=!&|?+-*%<>~^'.split(''));
const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);

export function maskSource(text) {
  const n = text.length;
  const code = new Array(n);
  const comm = new Array(n);
  for (let k = 0; k < n; k++) { const c = text[k]; code[k] = c === '\n' || c === '\r' ? c : ' '; comm[k] = code[k]; }
  let prevSig = ''; // last significant (non-space) char emitted as code
  let prevWord = '';

  const emitCode = (i) => { code[i] = text[i]; };
  const track = (ch) => {
    if (/\s/.test(ch)) return;
    if (/[A-Za-z0-9_$]/.test(ch)) prevWord = /[A-Za-z0-9_$]/.test(prevSig) ? prevWord + ch : ch; else prevWord = '';
    prevSig = ch;
  };

  function scanCode(i, untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = text[i]; const d = text[i + 1];
      if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') { comm[i] = text[i]; i++; } continue; }
      if (c === '/' && d === '*') {
        comm[i] = '/'; comm[i + 1] = '*'; i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] !== '\n' && text[i] !== '\r') comm[i] = text[i]; i++; }
        if (i < n) { comm[i] = '*'; comm[i + 1] = '/'; i += 2; }
        continue;
      }
      if (c === '"' || c === "'") { emitCode(i); i = scanString(i + 1, c); if (i <= n) { if (text[i - 1] === c) emitCode(i - 1); } prevSig = c; prevWord = ''; continue; }
      if (c === '`') { emitCode(i); i = scanTemplate(i + 1); prevSig = '`'; prevWord = ''; continue; }
      if (c === '/' ) {
        const regexAllowed = prevSig === '' || REGEX_PREV.has(prevSig) || REGEX_KW.has(prevWord);
        if (regexAllowed) {
          emitCode(i); i++;
          let inClass = false;
          while (i < n && text[i] !== '\n') {
            const r = text[i];
            if (r === '\\') { i += 2; continue; }
            if (r === '[') inClass = true; else if (r === ']') inClass = false;
            else if (r === '/' && !inClass) { emitCode(i); i++; break; }
            i++;
          }
          while (i < n && /[a-z]/i.test(text[i])) { emitCode(i); i++; }
          prevSig = '/'; prevWord = '';
          continue;
        }
      }
      if (untilBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return i; depth--; }
      }
      emitCode(i); track(c); i++;
    }
    return i;
  }

  function scanString(i, quote) {
    while (i < n) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === quote) return i + 1;
      if (c === '\n') return i; // unterminated: stop at line end
      i++;
    }
    return i;
  }

  function scanTemplate(i) {
    while (i < n) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { emitCode(i); return i + 1; }
      if (c === '$' && text[i + 1] === '{') {
        emitCode(i); emitCode(i + 1);
        const end = scanCode(i + 2, true);
        if (end < n) emitCode(end);
        i = end + 1; continue;
      }
      i++;
    }
    return i;
  }

  scanCode(0, false);
  return { code: code.join(''), comments: comm.join('') };
}

// .vue / .svelte / .astro: keep only <script> bodies (astro: also the --- frontmatter), blank the rest but keep line numbers.
export function extractScripts(text, ext) {
  const out = new Array(text.length);
  for (let k = 0; k < text.length; k++) out[k] = text[k] === '\n' || text[k] === '\r' ? text[k] : ' ';
  const keep = (from, to) => { for (let k = from; k < to; k++) out[k] = text[k]; };
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m; let any = false;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].indexOf('>') + 1;
    keep(start, start + m[1].length); any = true;
  }
  if (ext === '.astro') {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm) { keep(4, 4 + fm[1].length); any = true; }
  }
  return any ? out.join('') : null;
}

export function lineOf(text, index) {
  let line = 1;
  for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
}

export function lineStarts(text) {
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) starts.push(k + 1);
  return starts;
}
export function lineAt(starts, index) {
  let lo = 0; let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

// raw text with comments blanked (strings kept) — for import extraction that needs module specifiers
export function blankComments(text) {
  const { comments } = maskSource(text);
  if (!/[^\s]/.test(comments)) return text;
  const out = new Array(text.length);
  for (let k = 0; k < text.length; k++) out[k] = comments[k] !== ' ' && comments[k] !== '\n' && comments[k] !== '\r' ? ' ' : text[k];
  return out.join('');
}
