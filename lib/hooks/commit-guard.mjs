// H3 commit-guard: while a run is ready/locked/applying/verifying the only commit path is `ts-opt commit` (doc 03 H3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleCommands } from './shellnorm.mjs';
import { emit, findOpenRun, logHook, readInput, runHook } from './io.mjs';

const GUARDED = new Set(['ready', 'locked', 'applying', 'verifying']);

/** true when the line really runs `git [-C x] [-c k=v] commit` (also behind VAR=… prefixes, env/sudo/time wrappers, `sh -c` and `eval`); quoted text like `echo "git commit"` does not count */
export function isGitCommit(command) {
  const cmds = simpleCommands(String(command || ''));
  if (cmds.unsafe && /\bgit\b[\s\S]*\bcommit\b/.test(String(command))) return true; // cannot parse it and it mentions a commit: treat as one while a run is open
  for (const [cmd, ...rest] of cmds) {
    if (cmd !== 'git') continue;
    let a = rest;
    while (a.length) {
      if (a[0] === '-C' || a[0] === '-c' || a[0] === '--git-dir' || a[0] === '--work-tree' || a[0] === '--namespace') a = a.slice(2);
      else if (a[0].startsWith('--git-dir=') || a[0].startsWith('--work-tree=') || a[0].startsWith('--namespace=') || a[0] === '--no-pager' || a[0] === '-p' || a[0] === '--no-replace-objects' || a[0] === '--literal-pathspecs') a = a.slice(1);
      else break;
    }
    if (a[0] === 'commit' || a[0] === 'ci') return true;
  }
  return false;
}

runHook(async () => {
  const input = await readInput();
  if (input.tool_name !== 'Bash') return;
  if (!isGitCommit(input.tool_input?.command)) return;
  const open = findOpenRun(input.cwd);
  if (!open) return;
  let state = null;
  try { state = JSON.parse(readFileSync(join(open.root, '.ts-optimize', 'runs', open.id, 'run.json'), 'utf8')).state; } catch { return; }
  if (!GUARDED.has(state)) return;
  logHook(input.cwd, { handler: 'commit-guard', tool: 'Bash', decision: 'deny', state });
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `ts-optimize: run ${open.id} is ${state}; commit with \`ts-opt commit <F-id> [-m summary]\` (it checks scope, protected paths, the fast check and previous wave gates, and writes the Finding trailer). To leave the run: \`ts-opt run abort\`.` } });
});
