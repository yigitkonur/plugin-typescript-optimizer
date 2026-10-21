// H5 agent-guard: plugin subagents (ts-triager, ts-architect) are read-only (doc 03 H5). Allow-lists Bash, denies secret-path reads.
// The shell prefilter only starts Node when the hook input names one of this plugin's subagents.
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { compileGlob } from '../core/glob.mjs';
import { PLUGIN_ROOT } from '../core/home.mjs';
import { emit, isMain, logHook, readInput, runHook } from './io.mjs';

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

const SIMPLE = new Set(['rg', 'wc', 'head', 'tail', 'sort', 'uniq', 'cut', 'tr', 'ls', 'tree', 'jq']);
const GIT_OK = new Set(['ls-files', 'log', 'show', 'blame', 'diff', 'rev-parse']); // `git grep` is not offered: rg does the searching
// what each plugin subagent may run: the triager records verdicts (no findings exist yet), the architect records proposals
const TS_OPT_OK = {
  triager: [['verdict', 'add'], ['verdict', 'status'], ['rule']],
  architect: [['proposal', 'add'], ['rule'], ['findings', 'show'], ['findings', 'list']],
};
export const agentKind = (input) => { const t = String(input?.agent_type || ''); return /(^|:)ts-triager$/.test(t) ? 'triager' : /(^|:)ts-architect$/.test(t) ? 'architect' : null; };
const GLOB_CH = /[*?[]/;
const FILE_TOOLS = new Set(['ls', 'tree', 'wc', 'head', 'tail', 'sort', 'uniq', 'cut']);

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

const optName = (a) => a.split('=')[0];
const shortCluster = (a, chars) => /^-[A-Za-z0-9.]+$/.test(a) && [...a.slice(1)].some((c) => chars.includes(c));
/** rg applies globs in order and the last match wins, so a positive -g/--glob/--iglob would re-include the secret paths that the rc excludes: only `!` globs are allowed */
function positiveGlob(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let v = null;
    if (/^--i?glob(=|$)/.test(a)) v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : (args[i + 1] ?? '');
    else if (/^-[A-Za-z0-9]*g/.test(a)) v = a.slice(a.indexOf('g') + 1) || (args[i + 1] ?? '');
    if (v !== null && !v.startsWith('!')) return true;
  }
  return false;
}
let realRoots = null;
function roots(cwd) {
  const out = [];
  for (const r of [resolve(cwd || process.cwd()), PLUGIN_ROOT]) { try { out.push(realpathSync(r)); } catch { out.push(r); } }
  return out;
}
const underAny = (p, bases) => bases.some((b) => p === b || p.startsWith(b.endsWith('/') ? b : b + '/'));

/** a token that names an existing file: its REAL path must be inside the repository (or the plugin) and not a secret; a token that does not exist is a pattern */
function pathProblem(token, cwd) {
  const cands = new Set([token.replace(/^--?[\w-]+=/, '')]);
  for (const c of [...cands]) if (c.includes(':')) for (const part of c.split(':')) cands.add(part); // git <rev>:<path>
  for (const c of cands) {
    if (!c || c.length > 4096) continue;
    if (isSecretPath(c, cwd)) return `${token} looks like a secret path`;
    let real = null;
    try { real = realpathSync(resolve(cwd || process.cwd(), c)); } catch { continue; }
    if (isSecretPath(real, cwd)) return `${token} resolves to a secret path`;
    if (!underAny(real, roots(cwd))) return `${token} resolves outside the repository`;
  }
  return null;
}

/** -> null (allowed) | reason string (denied) */
export function checkBash(command, cwd, kind) {
  const { segments, redirects, subs, unsafe } = parseShell(command);
  if (unsafe) return `cannot parse the command safely (${unsafe})`;
  if (redirects.length) return 'output/input redirection is not allowed for read-only subagents';
  for (const s of subs) { const r = checkBash(s, cwd, kind); if (r) return r; }
  if (!segments.length) return null;
  for (const seg of segments) {
    let [cmd, ...args] = seg;
    if (cmd === 'git') {
      while (args[0] === '-C' || args[0] === '--no-pager') {
        if (args[0] === '-C') { const dir = args[1]; const pr = dir && pathProblem(dir, cwd); if (!dir || pr) return pr || 'git -C needs a directory'; args = args.slice(2); } else args = args.slice(1);
      }
      const sub = args[0];
      if (!GIT_OK.has(sub)) return `git ${sub || ''} is not allowed for read-only subagents`;
      if (args.some((a) => /^(-O|--open-files-in-pager|--output|--no-index|--ext-diff|--textconv|--exec-path)/.test(a))) return 'git output, pager, no-index and external-program options are not allowed';
    } else if (cmd === 'find') {
      if (args.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(a))) return 'find actions are not allowed';
      const starts = []; for (const a of args) { if (a.startsWith('-') || a === '(' || a === '!') break; starts.push(a); }
      if (starts.some((a) => GLOB_CH.test(a))) return 'wildcards are not expanded for read-only commands; give find a directory';
    } else if (cmd === 'ts-opt') {
      if (!(TS_OPT_OK[kind] || []).some((p) => p.every((w, i) => args[i] === w))) return `ts-opt ${args.slice(0, 2).join(' ')} is not allowed for ${kind || 'this'} subagent${kind ? `s (allowed: ${TS_OPT_OK[kind].map((p) => 'ts-opt ' + p.join(' ')).join(', ')})` : ''}`;
      continue; // arguments are free text (evidence strings) — no path check
    } else if (cmd === 'cd') {
      return 'cd is not needed: commands already run in the repository root, so give rg or find the path instead';
    } else if (['for', 'while', 'until', 'if', 'case', 'function'].includes(cmd)) {
      return `shell ${cmd} constructs are not allowed: use rg or find, which already search many files`;
    } else if (!SIMPLE.has(cmd)) return `${cmd || 'that command'} is not allowed for read-only subagents (allowed: rg, git log/show/blame/diff/ls-files/rev-parse, ls, tree, find without -delete/-exec, wc, head, tail, sort, uniq, cut, tr, jq, and ${(TS_OPT_OK[kind] || []).map((p) => 'ts-opt ' + p.join(' ')).join(', ') || 'no ts-opt command'})`;
    const opts = args.filter((a) => a.startsWith('-'));
    if (cmd === 'rg') {
      if (opts.some((a) => ['--pre', '--pre-glob', '--search-zip', '--hostname-bin', '--no-config', '--hidden', '--no-ignore', '--no-ignore-vcs', '--no-ignore-dot', '--no-ignore-global', '--no-ignore-parent', '--no-ignore-files', '--no-ignore-exclude', '--unrestricted', '--follow', '--generate', '--type-add'].includes(optName(a)) || shortCluster(a, 'zuL.'))) return 'rg flags that run programs, read archives, follow links or reach ignored or hidden files are not allowed';
      if (positiveGlob(args)) return 'rg --glob must start with ! (exclude); a positive glob could reach secret files. Restrict file kinds with -t instead (for example -t json, -t ts)';
    } else if (cmd === 'sort') {
      if (opts.some((a) => ['--output', '--compress-program', '--files0-from'].includes(optName(a)) || shortCluster(a, 'o'))) return 'sort output and program options are not allowed';
    } else if (cmd === 'tree') {
      if (opts.some((a) => ['--output', '--fromfile'].includes(optName(a)) || shortCluster(a, 'o'))) return 'tree output options are not allowed';
    } else if (cmd === 'uniq') {
      if (args.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a)).length > 1) return 'uniq with an output file is not allowed';
    } else if (cmd === 'jq') {
      if (opts.some((a) => ['--rawfile', '--slurpfile', '--argfile', '--from-file', '-L'].includes(optName(a)) || a === '-f')) return 'jq file-loading options are not allowed';
      const prog = args.find((a) => !a.startsWith('-'));
      if (prog && /\$ENV|\benv\b|\binclude\b|\bimport\b|input_filename|\$__prog/.test(prog)) return 'jq programs may not read the environment or load modules';
    }
    if (FILE_TOOLS.has(cmd)) for (const a of args) if (!a.startsWith('-') && GLOB_CH.test(a)) return 'wildcards are not expanded for read-only commands; use rg or find';
    for (const a of args) {
      if (a.startsWith('-') && !a.includes('/') && !a.includes('.') && !a.includes('=')) continue;
      const pr = pathProblem(a, cwd);
      if (pr) return pr;
    }
  }
  return null;
}

/** ripgrep reads RIPGREP_CONFIG_PATH: this file adds the secret-path exclusions to every rg a subagent runs */
export const RG_RC = join(PLUGIN_ROOT, 'catalog', 'rg-secrets.rc');
const usesRg = (command) => { try { return parseShell(String(command)).segments.some((s) => s[0] === 'rg') || parseShell(String(command)).subs.some(usesRg); } catch { return false; } };
export const withRgConfig = (command) => `export RIPGREP_CONFIG_PATH='${RG_RC.replace(/'/g, `'\\''`)}'; ${command}`;

/** -> {decision:'allow'|'deny'|null, reason} — allow pre-approves exactly what a read-only plugin subagent needs, so triage never stalls on permission prompts */
export function decide(input) {
  const kind = agentKind(input);
  if (!kind) return { decision: null }; // the shell pre-filter in hooks.json is a text match; only the two plugin subagents are restricted here
  const tool = input.tool_name;
  const cwd = input.cwd || process.cwd();
  const within = (p, base) => { const a = resolve(cwd, p); return a === base || a.startsWith(base.endsWith('/') ? base : base + '/'); };
  if (tool === 'Bash') {
    const command = String(input.tool_input?.command ?? '');
    const reason = checkBash(command, cwd, kind);
    if (reason) return { decision: 'deny', reason };
    return { decision: 'allow', reason: 'read-only triage command', ...(usesRg(command) ? { updatedCommand: withRgConfig(command) } : {}) };
  }
  if (tool === 'Read') {
    const p = String(input.tool_input?.file_path ?? '');
    if (isSecretPath(p, cwd)) return { decision: 'deny', reason: `${p} looks like a secret path` };
    let real = null; try { real = realpathSync(resolve(cwd, p)); } catch { /* new or missing file: the tool reports it */ }
    if (real && isSecretPath(real, cwd)) return { decision: 'deny', reason: `${p} resolves to a secret path` };
    if (real && !underAny(real, roots(cwd))) return { decision: 'deny', reason: `${p} resolves outside the repository` };
    return within(p, resolve(cwd)) || within(p, PLUGIN_ROOT) ? { decision: 'allow', reason: 'read inside the repository or the plugin' } : { decision: null };
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const ti = input.tool_input || {};
    for (const v of [ti.path, ti.glob, ti.pattern].filter((x) => typeof x === 'string')) if (tool === 'Glob' || v !== ti.pattern) {
      if (isSecretPath(v, cwd)) return { decision: 'deny', reason: `${v} looks like a secret path` };
      const pr = typeof ti.path === 'string' && v === ti.path ? pathProblem(v, cwd) : null;
      if (pr) return { decision: 'deny', reason: pr };
    }
    return { decision: null };
  }
  return { decision: null };
}

if (isMain(import.meta.url)) {
  runHook(async () => {
    const input = await readInput();
    const d = decide(input);
    logHook(input.cwd, { handler: 'agent-guard', tool: input.tool_name, agent_type: input.agent_type, decision: d.decision || 'defer', ...(d.decision === 'deny' ? { reason: String(d.reason).slice(0, 120) } : {}) });
    if (d.decision === 'deny') emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `ts-optimize: ${String(d.reason).slice(0, 300)}. Plugin subagents are read-only.` } });
    else if (d.decision === 'allow') emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `ts-optimize: ${d.reason}`, ...(d.updatedCommand ? { updatedInput: { ...(input.tool_input || {}), command: d.updatedCommand } } : {}) } });
  });
}
