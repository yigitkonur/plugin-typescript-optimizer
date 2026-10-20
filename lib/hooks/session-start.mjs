// H1 resume-context: after compact/resume/clear/startup, point the agent at the open run (doc 03 H1). Silent when no run is open.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit, findOpenRun, readInput, runHook } from './io.mjs';

function line(run, id) {
  const st = run.state || 'unknown';
  const dir = `.ts-optimize/runs/${id}`;
  const a = run.applying || {};
  const branch = a.branch ?? run.branch; const wave = a.wave ?? run.wave; const fip = a.finding ?? run.finding_in_progress;
  const f = fip ? `; ${fip} in progress` : '';
  switch (st) {
    case 'applying':
      return `ts-optimize: run ${id} is APPLYING on branch ${branch || '?'} (wave ${wave || '?'}${a.pass > 1 ? `, pass ${a.pass}` : ''}${f}). Continue with /ts-optimize:fix; commits go through \`ts-opt commit\` only. State: ${dir}/run.json`;
    case 'verifying':
      return `ts-optimize: run ${id} is VERIFYING (wave ${wave || '?'} gate). Continue with /ts-optimize:fix. State: ${dir}/run.json`;
    case 'locked': case 'ready':
      return `ts-optimize: run ${id} is ${st.toUpperCase()}: the plan is approved/ready but no edits have started. Continue with /ts-optimize:fix. State: ${dir}/run.json`;
    case 'planned':
      return `ts-optimize: audit run ${id} awaits review. Edit ${dir}/plan.md (tick [x]), then run /ts-optimize:fix.`;
    default:
      return `ts-optimize: run ${id} is open (state ${st}). Run \`ts-opt run status\` to see where it stands. State: ${dir}/run.json`;
  }
}

runHook(async () => {
  const input = await readInput();
  const open = findOpenRun(input.cwd);
  if (!open) return;
  let run = {};
  try { run = JSON.parse(readFileSync(join(open.root, '.ts-optimize', 'runs', open.id, 'run.json'), 'utf8')); } catch { /* run.json may not exist yet */ }
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line(run, open.id).slice(0, 700) } });
});
