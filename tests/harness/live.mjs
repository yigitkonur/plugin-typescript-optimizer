#!/usr/bin/env node
// Run a prompt (usually a /ts-optimize:* slash command) headless against a fixture with this plugin loaded,
// save the stream-json transcript and a condensed markdown view.
//   node tests/harness/live.mjs --fixture F01 --prompt "/ts-optimize:doctor" --row 3 [--max-turns 40]
//        [--timeout 1200] [--silence 120] [--no-reset] [--model sonnet] [--allow "Bash(ts-opt *)"] [--perm acceptEdits]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './fixture.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes('--' + name);
const all = (name) => args.flatMap((a, i) => (a === '--' + name ? [args[i + 1]] : []));

const fixture = opt('fixture');
const prompt = opt('prompt');
const row = opt('row', 'adhoc');
if ((!fixture && !opt('cwd')) || !prompt) { console.error('usage: live.mjs (--fixture Fxx | --cwd <dir> --installed) --prompt "<text>" --row <id> [...]'); process.exit(2); }
const maxTurns = opt('max-turns', '40');
const timeoutMs = Number(opt('timeout', '1200')) * 1000;
const silenceMs = Number(opt('silence', '120')) * 1000;
const model = opt('model', 'sonnet');

// --cwd + --installed: run in an arbitrary checkout with the plugin loaded from the marketplace install (no --plugin-dir), under a throwaway TS_OPT_HOME
const cwd = opt('cwd') || ensureFixture(fixture, { reset: !flag('no-reset') });
const home = opt('home') || join(DEV, 'home');
mkdirSync(home, { recursive: true });
const outDir = join(REPO, 'tests', 'transcripts');
mkdirSync(outDir, { recursive: true });

const cargs = ['-p', prompt, ...(flag('installed') ? [] : ['--plugin-dir', REPO]), '--model', model, '--setting-sources', opt('sources', 'project'),
  '--output-format', 'stream-json', '--verbose', '--max-turns', maxTurns];
for (const a of all('allow')) cargs.push('--allowedTools', a);
if (opt('perm')) cargs.push('--permission-mode', opt('perm'));
for (const a of all('arg')) cargs.push(a);

console.error(`[live] row=${row} fixture=${fixture} cwd=${cwd}\n[live] claude ${cargs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
const t0 = Date.now();
const child = spawn('claude', cargs, { cwd, env: { ...process.env, TS_OPT_HOME: home, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let last = Date.now(); let buf = ''; const lines = []; let stderr = ''; let killed = '';
const kill = (why) => { killed = why; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); };
const wd = setInterval(() => {
  if (Date.now() - t0 > timeoutMs) kill(`overall timeout ${timeoutMs / 1000}s`);
  else if (Date.now() - last > silenceMs) kill(`no output for ${silenceMs / 1000}s`);
}, 2000);
child.stdout.on('data', (d) => { last = Date.now(); buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
child.stderr.on('data', (d) => { last = Date.now(); stderr += d; });
child.on('close', (code) => {
  clearInterval(wd);
  if (buf) lines.push(buf);
  const scrub = (s) => s.split(homedir()).join('~').replace(/\/Users\/[A-Za-z0-9_.-]*…/g, '~/…');
  writeFileSync(join(outDir, `${row}.jsonl`), scrub(lines.join('\n')) + '\n');
  const md = condense(lines, { row, fixture, prompt, code, killed, ms: Date.now() - t0, stderr });
  writeFileSync(join(outDir, `${row}.md`), scrub(md));
  console.log(scrub(md));
  process.exit(killed ? 124 : code ?? 1);
});

function trunc(s, n = 400) { s = typeof s === 'string' ? s : JSON.stringify(s); return s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s; }

function condense(lines, m) {
  const out = [`# Transcript row ${m.row} — ${m.fixture}`, '', `prompt: \`${m.prompt}\``, `exit: ${m.code}${m.killed ? ` (KILLED: ${m.killed})` : ''} · ${Math.round(m.ms / 1000)}s`, ''];
  const edits = new Set(); const agents = []; let final = ''; let turns = ''; let cost = '';
  out.push('## Tool calls', '');
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'assistant') for (const c of e.message?.content || []) {
      if (c.type === 'tool_use') {
        out.push(`- **${c.name}** ${trunc(c.input)}`);
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) edits.add(c.input?.file_path || c.input?.path || '?');
        if (c.name === 'Agent' || c.name === 'Task') agents.push(c.input?.subagent_type || c.input?.description || '?');
      }
    }
    if (e.type === 'user') for (const c of e.message?.content || []) {
      if (c.type === 'tool_result') out.push(`  ← ${trunc(Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('') : c.content, 300).replace(/\n/g, '⏎')}`);
    }
    if (e.type === 'result') { final = e.result || ''; turns = e.num_turns; cost = e.total_cost_usd; }
  }
  out.push('', `## Edit/Write paths (${edits.size})`, ...[...edits].map((p) => `- ${p}`));
  out.push('', `## Agent dispatches (${agents.length})`, ...agents.map((p) => `- ${p}`));
  out.push('', `## Final (turns=${turns} cost=$${cost})`, '', final || '(no result event)');
  if (m.stderr.trim()) out.push('', '## stderr', '```', m.stderr.trim().slice(-1500), '```');
  return out.join('\n') + '\n';
}
