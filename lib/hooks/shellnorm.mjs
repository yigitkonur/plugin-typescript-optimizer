// Normalise a shell command line into the simple commands it would run, looking through the usual wrappers:
// leading VAR=value assignments, env/command/exec/nohup/time/nice/sudo/timeout/xargs, `sh -c "…"`, `eval "…"`, command substitutions.
// Used by the commit and command guards, which must see `FOO=1 git commit` and `bash -c 'git commit'` as what they are.
import { parseShell } from './agent-guard.mjs';

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAP_PLAIN = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'sudo', 'doas', 'stdbuf', 'setsid', 'ionice', 'nice', 'caffeinate']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const base = (w) => String(w || '').split('/').pop();
const MAX_DEPTH = 6;

function unwrap(seg, out, depth) {
  let words = [...seg];
  for (let guard = 0; guard < 24 && words.length; guard++) {
    const w = words[0];
    if (ASSIGN.test(w)) { words = words.slice(1); continue; }
    const b = base(w);
    if (b === 'env') { words = words.slice(1); while (words[0] && (words[0].startsWith('-') || ASSIGN.test(words[0]))) { const o = words.shift(); if (['-u', '-C', '-S'].includes(o)) words.shift(); } continue; }
    if (b === 'timeout') { words = words.slice(1); while (words[0] && words[0].startsWith('-')) words.shift(); words.shift(); continue; }
    if (b === 'xargs') { words = words.slice(1); while (words[0] && words[0].startsWith('-')) { const o = words.shift(); if (['-n', '-P', '-I', '-L', '-s', '-d', '-E', '-a'].includes(o)) words.shift(); } continue; }
    if (WRAP_PLAIN.has(b)) { words = words.slice(1); while (words[0] && words[0].startsWith('-')) { const o = words.shift(); if (['-n', '-c', '-p', '-u'].includes(o) && b !== 'time') words.shift(); } continue; }
    if (SHELLS.has(b)) {
      const i = words.findIndex((x) => /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
      if (i >= 0 && words[i + 1] !== undefined && depth < MAX_DEPTH) { expand(words[i + 1], out, depth + 1); return; }
    }
    if (b === 'eval' && depth < MAX_DEPTH) { expand(words.slice(1).join(' '), out, depth + 1); return; }
    break;
  }
  if (words.length) out.push([base(words[0]), ...words.slice(1)]);
}

function expand(command, out, depth) {
  const p = parseShell(String(command || ''));
  if (p.unsafe) { out.unsafe = p.unsafe; }
  for (const seg of p.segments) unwrap(seg, out, depth);
  for (const sub of p.subs) if (depth < MAX_DEPTH) expand(sub, out, depth + 1);
}

/** -> array of [command, ...args] (command is a basename), with `.unsafe` set when part of the line could not be parsed */
export function simpleCommands(command) {
  const out = []; out.unsafe = null;
  expand(command, out, 0);
  return out;
}
