// H6 cli-allow: re-grants the audit skill's pre-approved `ts-opt` calls (doc 03). A skill's allowed-tools grant lapses when a
// background subagent's completion starts a new turn, which stalled /ts-optimize:audit after triage dispatch (live run 2.3).
// Allows ONLY single `ts-opt` commands whose writes stay inside .ts-optimize/. Everything else: no output.
//  - read-only commands (detect, doctor, validate, rule, findings list|show): always;
//  - the triage commands (verdict, findings ingest, triage, knip-overlay): only while an audit-phase run (scanning, triaging or
//    planned) was written to in the last 6 hours;
//  - never `scan`: it runs Knip, which loads the project's config files, and the first scan is covered by the skill's own grant.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { emit, isMain, logHook, readInput, runHook } from './io.mjs';
import { parseShell } from './agent-guard.mjs';

const READ_ONLY = new Set(['detect', 'doctor', 'validate', 'rule']);
const AUDIT_RUN_ONLY = new Set(['triage', 'verdict', 'knip-overlay']);
const FINDINGS_READ = new Set(['list', 'show']);
const AUDIT_STATES = new Set(['scanning', 'triaging', 'planned']);
export const AUDIT_WINDOW_MS = 6 * 3600 * 1000;

export function decide(command, auditOpen = false) {
  const p = parseShell(String(command || ''));
  if (p.unsafe || p.redirects.length || p.subs.length || p.segments.length !== 1) return null;
  const [cmd, sub, sub2, ...rest] = p.segments[0];
  if (cmd !== 'ts-opt') return null;
  if ([sub2, ...rest].some((a) => a === '--abandon-open')) return null; // aborting an open run is the user's call
  if (READ_ONLY.has(sub) || (sub === 'findings' && FINDINGS_READ.has(sub2))) return `read-only command: ts-opt ${sub}`;
  if (auditOpen && (AUDIT_RUN_ONLY.has(sub) || (sub === 'findings' && sub2 === 'ingest'))) return `audit-run command: ts-opt ${sub}`;
  return null;
}

/** the newest run of the repository is in an audit phase and was written to within the window */
export function auditRunOpen(cwd, now = Date.now()) {
  let d = resolve(cwd || process.cwd());
  for (;;) {
    const runs = join(d, '.ts-optimize', 'runs');
    if (existsSync(runs)) {
      try {
        const id = readdirSync(runs).sort().pop();
        if (!id) return false;
        const f = join(runs, id, 'run.json');
        const state = JSON.parse(readFileSync(f, 'utf8')).state;
        return AUDIT_STATES.has(state) && now - statSync(f).mtimeMs < AUDIT_WINDOW_MS;
      } catch { return false; }
    }
    if (existsSync(join(d, '.git'))) return false;
    const n = dirname(d); if (n === d) return false; d = n;
  }
}

// run as a hook only when started directly: importing the module (tests) must not wait on stdin
if (isMain(import.meta.url)) runHook(async () => {
  const input = await readInput();
  if (input.agent_type) return; // plugin subagents are handled by agent-guard
  const command = input.tool_input?.command;
  const why = decide(command, auditRunOpen(input.cwd || process.cwd()));
  logHook(input.cwd, { handler: 'cli-allow', tool: input.tool_name, decision: why ? 'allow' : 'defer' });
  if (why) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `ts-optimize: ${why}` } });
});
