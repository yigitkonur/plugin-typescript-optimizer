// H5 agent-guard: plugin subagents (ts-triager, ts-architect) are read-only (doc 03 H5). Allow-lists Bash, denies secret-path reads.
// The shell prefilter only starts Node when the hook input names one of this plugin's subagents.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { compileGlob } from '../core/glob.mjs';
import { PLUGIN_ROOT } from '../core/home.mjs';
import { emit, logHook, readInput, runHook } from './io.mjs';

const OPS = ['&&', '||', ';', '|', '&', '\n'];

/** minimal shell tokenizer: -> {segments:[[word…]], redirects:[...], subs:[string], unsafe:string|null} */
export function parseShell(cmd) {
  const segments = []; let cur = []; let word = ''; let hasWord = false;
  const redirects = []; const subs = []; let unsafe = null;
  const pushWord = () => { if (hasWord) { cur.push(word); word = ''; hasWord = false; } };
  const pushSeg = () => { pushWord(); if (cur.length) segments.push(cur); cur = []; };
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === '\\') { word += cmd[i + 1] ?? ''; hasWord = true; i += 2; continue; }
    if (c === "'") { const j = cmd.indexOf("'", i + 1); if (j < 0) { unsafe = 'unterminated quote'; break; } word += cmd.slice(i + 1, j); hasWord = true; i = j + 1; continue; }
    if (c === '"') {
      let j = i + 1; let s = '';
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\') { s += cmd[j + 1] ?? ''; j += 2; continue; }
        if (cmd[j] === '$' && cmd[j + 1] === '(') { const e = matchParen(cmd, j + 1); if (e < 0) { unsafe = 'unterminated $('; break; } subs.push(cmd.slice(j + 2, e)); j = e + 1; continue; }
        if (cmd[j] === '`') { const e = cmd.indexOf('`', j + 1); if (e < 0) { unsafe = 'unterminated backtick'; break; } subs.push(cmd.slice(j + 1, e)); j = e + 1; continue; }
        s += cmd[j]; j++;
      }
      if (unsafe) break;
      word += s; hasWord = true; i = j + 1; continue;
    }
    if (c === '$' && cmd[i + 1] === '(') { const e = matchParen(cmd, i + 1); if (e < 0) { unsafe = 'unterminated $('; break; } subs.push(cmd.slice(i + 2, e)); word += 'SUB'; hasWord = true; i = e + 1; continue; }
    if (c === '`') { const e = cmd.indexOf('`', i + 1); if (e < 0) { unsafe = 'unterminated backtick'; break; } subs.push(cmd.slice(i + 1, e)); word += 'SUB'; hasWord = true; i = e + 1; continue; }
    if (c === '<' && cmd[i + 1] === '(' || c === '>' && cmd[i + 1] === '(') { unsafe = 'process substitution'; break; }
    if (c === '>' || c === '<') {
      // allowed: 2>&1 and redirects to /dev/null; everything else is a file redirect
      const rest = cmd.slice(i);
      const mm = /^(>>?|<<?<?)\s*(&\d+|\/dev\/null)/.exec(rest);
      if (mm) { i += mm[0].length; if (/^\d$/.test(word) && hasWord) { word = ''; hasWord = false; } continue; }
      redirects.push(c); i++; if (cmd[i] === c) i++; continue;
    }
    let matched = null;
    for (const op of ['&&', '||', ';', '|', '&', '\n']) if (cmd.startsWith(op, i)) { matched = op; break; }
    if (matched) { pushSeg(); i += matched.length; continue; }
    if (/\s/.test(c)) { pushWord(); i++; continue; }
    word += c; hasWord = true; i++;
  }
  pushSeg();
  return { segments, redirects, subs, unsafe };
}
function matchParen(s, open) { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { d--; if (d === 0) return i; } } return -1; }

const SIMPLE = new Set(['rg', 'wc', 'head', 'tail', 'sort', 'uniq', 'ls', 'tree', 'jq']);
const GIT_OK = new Set(['grep', 'ls-files', 'log', 'show', 'blame', 'diff', 'rev-parse']);
const TS_OPT_OK = [['verdict', 'add'], ['verdict', 'status'], ['proposal', 'add'], ['rule'], ['findings', 'show'], ['findings', 'list']];

let secretRes = null;
function secrets() {
  if (secretRes) return secretRes;
  let globs = ['**/.env*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/.npmrc', '**/.netrc'];
  try { const j = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'catalog', 'secret-paths.json'), 'utf8')); if (Array.isArray(j.globs)) globs = j.globs; } catch { /* default list */ }
  secretRes = globs.map((g) => compileGlob(g, { dot: true }));
  return secretRes;
}
export function isSecretPath(p, cwd) {
  if (!p) return false;
  const abs = isAbsolute(p) ? p : resolve(cwd || process.cwd(), p);
  const norm = abs.split('\\').join('/').replace(/^\/+/, '');
  return secrets().some((re) => re.test(norm) || re.test(p.split('\\').join('/')));
}

/** -> null (allowed) | reason string (denied) */
export function checkBash(command, cwd) {
  const { segments, redirects, subs, unsafe } = parseShell(command);
  if (unsafe) return `cannot parse the command safely (${unsafe})`;
  if (redirects.length) return 'output/input redirection is not allowed for read-only subagents';
  for (const s of subs) { const r = checkBash(s, cwd); if (r) return r; }
  if (!segments.length) return null;
  for (const seg of segments) {
    let [cmd, ...args] = seg;
    if (cmd === 'git') {
      while (args[0] === '-C' || args[0] === '--no-pager') args = args[0] === '-C' ? args.slice(2) : args.slice(1);
      const sub = args[0];
      if (!GIT_OK.has(sub)) return `git ${sub || ''} is not allowed for read-only subagents`;
      if (args.some((a) => a === '--output' || a.startsWith('--output=') || a === '--ext-diff')) return 'git output options are not allowed';
    } else if (cmd === 'find') {
      if (args.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'].includes(a))) return 'find actions are not allowed';
    } else if (cmd === 'ts-opt') {
      if (!TS_OPT_OK.some((p) => p.every((w, i) => args[i] === w))) return `ts-opt ${args.slice(0, 2).join(' ')} is not allowed for read-only subagents`;
      continue; // arguments are free text (evidence strings) — no path check
    } else if (!SIMPLE.has(cmd)) return `${cmd || 'that command'} is not allowed for read-only subagents (allowed: rg, git grep/log/show/blame/diff/ls-files, ls, tree, find, wc, head, tail, sort, uniq, jq, ts-opt verdict/rule/findings)`;
    if (cmd === 'rg' && args.some((a) => ['--hidden', '-uu', '-uuu', '--no-ignore', '--no-ignore-vcs', '-u', '--follow', '-L'].includes(a))) return 'rg flags that reach ignored or hidden files are not allowed';
    for (const a of args) if (!a.startsWith('-') || a.includes('/') || a.includes('.')) if (isSecretPath(a.replace(/^--?[\w-]+=/, ''), cwd)) return `${a} looks like a secret path`;
  }
  return null;
}

/** -> {decision:'allow'|'deny'|null, reason} — allow pre-approves exactly what a read-only plugin subagent needs, so triage never stalls on permission prompts */
export function decide(input) {
  const tool = input.tool_name;
  const cwd = input.cwd || process.cwd();
  const within = (p, base) => { const a = resolve(cwd, p); return a === base || a.startsWith(base.endsWith('/') ? base : base + '/'); };
  if (tool === 'Bash') {
    const reason = checkBash(String(input.tool_input?.command ?? ''), cwd);
    return reason ? { decision: 'deny', reason } : { decision: 'allow', reason: 'read-only triage command' };
  }
  if (tool === 'Read') {
    const p = String(input.tool_input?.file_path ?? '');
    if (isSecretPath(p, cwd)) return { decision: 'deny', reason: `${p} looks like a secret path` };
    return within(p, resolve(cwd)) || within(p, PLUGIN_ROOT) ? { decision: 'allow', reason: 'read inside the repository or the plugin' } : { decision: null };
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const ti = input.tool_input || {};
    for (const v of [ti.path, ti.glob, ti.pattern].filter((x) => typeof x === 'string')) if (tool === 'Glob' || v !== ti.pattern) if (isSecretPath(v, cwd)) return { decision: 'deny', reason: `${v} looks like a secret path` };
    return { decision: null };
  }
  return { decision: null };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  runHook(async () => {
    const input = await readInput();
    const d = decide(input);
    logHook(input.cwd, { handler: 'agent-guard', tool: input.tool_name, agent_type: input.agent_type, decision: d.decision || 'defer', ...(d.decision === 'deny' ? { reason: String(d.reason).slice(0, 120) } : {}) });
    if (d.decision === 'deny') emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `ts-optimize: ${String(d.reason).slice(0, 170)}. Triage subagents are read-only.` } });
    else if (d.decision === 'allow') emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `ts-optimize: ${d.reason}` } });
  });
}
