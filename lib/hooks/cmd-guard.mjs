// H2 cmd-guard: two known-catastrophic one-liners (doc 03 H2): all-in-one `knip --fix`, and `npx tsc` fetching the obsolete registry package.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { simpleCommands } from './shellnorm.mjs';
import { emit, findOpenRun, logHook, readInput, runHook } from './io.mjs';

const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

/** -> {runner, tool, args} when the segment invokes `tool` directly or through a package runner */
function invoked(seg) {
  let [cmd, ...args] = seg;
  if (!cmd) return null;
  const base = cmd.split('/').pop();
  if (RUNNERS.has(base)) { while (args[0] && args[0].startsWith('-')) args = args.slice(1); return { runner: base, tool: args[0], args: args.slice(1) }; }
  if (['pnpm', 'yarn', 'npm'].includes(base)) {
    const sub = args[0];
    if (sub === 'dlx') return { runner: `${base} dlx`, tool: args[1], args: args.slice(2) };
    if (sub === 'exec' || sub === 'x') { const rest = args.slice(1).filter((a) => a !== '--'); return { runner: `${base} ${sub}`, tool: rest[0], args: rest.slice(1) }; }
    if (base !== 'npm') return { runner: base, tool: sub, args: args.slice(1) };
    return null;
  }
  return { runner: null, tool: base, args };
}

function typescriptPresent(cwd) {
  // resolvable from the repo: node_modules/typescript or .bin/tsc walking up (PnP repos resolve through yarn, not node_modules)
  let d = resolve(cwd);
  for (;;) {
    if (existsSync(join(d, 'node_modules', 'typescript', 'package.json')) || existsSync(join(d, 'node_modules', '.bin', 'tsc'))) return true;
    if (existsSync(join(d, '.pnp.cjs'))) return true;
    if (existsSync(join(d, '.git'))) return false;
    const n = dirname(d); if (n === d) return false; d = n;
  }
}
function isTsRepo(cwd) {
  let d = resolve(cwd);
  for (;;) {
    if (existsSync(join(d, '.ts-optimize'))) return true;
    for (const f of ['tsconfig.json', 'package.json']) {
      const p = join(d, f);
      if (!existsSync(p)) continue;
      if (f === 'tsconfig.json') return true;
      try { const j = JSON.parse(readFileSync(p, 'utf8')); if ([j.dependencies, j.devDependencies, j.peerDependencies].some((x) => x && x.typescript)) return true; } catch { /* malformed package.json */ }
    }
    if (existsSync(join(d, '.git'))) return false;
    const n = dirname(d); if (n === d) return false; d = n;
  }
}

export function decide(command, cwd, applying) {
  const cmds = simpleCommands(String(command || ''));
  for (const seg of cmds) {
    const v = invoked(seg);
    if (!v) continue;
    if (v.tool === 'knip') {
      const fix = v.args.some((a) => a === '--fix' || a === '-f' || a.startsWith('--fix=') || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a));
      if (!fix) continue;
      const fixType = v.args.some((a) => a === '--fix-type' || a.startsWith('--fix-type='));
      const removeFiles = v.args.includes('--allow-remove-files');
      if (!fixType) return { decision: applying ? 'deny' : 'ask', reason: 'all-in-one "knip --fix" would delete files, exports and dependencies in one unaudited pass. Scope it: knip --fix --fix-type exports --format (types, files, dependencies likewise). Findings drive scope: see /ts-optimize:fix.' };
      if (removeFiles && !applying) return { decision: 'ask', reason: '"knip --fix --fix-type files --allow-remove-files" deletes files outside a ts-optimize run: confirm that every file was triaged (see /ts-optimize:audit).' };
    }
    if (v.tool === 'tsc' && v.runner && ['npx', 'bunx', 'pnpx', 'pnpm dlx', 'yarn dlx'].includes(v.runner)) {
      if (!typescriptPresent(cwd)) return { decision: 'deny', reason: `"${v.runner} tsc" fetches the obsolete registry package "tsc@2.0.4" when typescript is not installed. Use node_modules/.bin/tsc, the package manager's exec (pnpm exec tsc), or let ts-opt pick the compiler (ts-opt check).` };
    }
  }
  return null;
}

runHook(async () => {
  const input = await readInput();
  if (input.tool_name !== 'Bash' || input.agent_type) return;
  const cwd = input.cwd || process.cwd();
  if (!isTsRepo(cwd)) return; // never speak in a repo without TypeScript
  const open = findOpenRun(cwd);
  let applying = false;
  if (open) { try { applying = JSON.parse(readFileSync(join(open.root, '.ts-optimize', 'runs', open.id, 'run.json'), 'utf8')).state === 'applying'; } catch { /* unreadable run */ } }
  const d = decide(input.tool_input?.command, cwd, applying);
  if (!d) return;
  logHook(cwd, { handler: 'cmd-guard', tool: 'Bash', decision: d.decision });
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: `ts-optimize: ${d.reason}`.slice(0, 400) } });
});
