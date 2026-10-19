// H6 cli-allow: re-grants the audit skill's pre-approved `ts-opt` calls (doc 03). A skill's allowed-tools grant lapses when a
// background subagent's completion starts a new turn, which stalled /ts-optimize:audit after triage dispatch (live run 2.3).
// Allows ONLY single `ts-opt` commands from the audit surface, whose writes stay inside .ts-optimize/. Everything else: no output.
import { emit, logHook, readInput, runHook } from './io.mjs';
import { parseShell } from './agent-guard.mjs';

const AUDIT_SURFACE = new Set(['detect', 'doctor', 'scan', 'triage', 'verdict', 'findings', 'validate', 'rule', 'knip-overlay']);
const FINDINGS_OK = new Set(['ingest', 'list', 'show']);

export function decide(command) {
  const p = parseShell(String(command || ''));
  if (p.unsafe || p.redirects.length || p.subs.length || p.segments.length !== 1) return null;
  const [cmd, sub, sub2, ...rest] = p.segments[0];
  if (cmd !== 'ts-opt' || !AUDIT_SURFACE.has(sub)) return null;
  if (sub === 'findings' && !FINDINGS_OK.has(sub2)) return null;
  if ([sub2, ...rest].some((a) => a === '--abandon-open')) return null; // aborting an open run is the user's call
  return `audit-surface command: ts-opt ${sub}`;
}

runHook(async () => {
  const input = await readInput();
  if (input.agent_type) return; // plugin subagents are handled by agent-guard
  const why = decide(input.tool_input?.command);
  logHook(input.cwd, { handler: 'cli-allow', tool: input.tool_name, decision: why ? 'allow' : 'defer' });
  if (why) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `ts-optimize: ${why}` } });
});
