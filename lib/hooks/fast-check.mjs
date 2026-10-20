// H4 fast-check (PostToolBatch): after a batch of tool calls in an applying run, typecheck with the fast compiler and tell the model
// about NEW errors only (doc 03 H4). Silent when nothing changed, when it just ran, when the fast compiler is off, or when all is well.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit, findOpenRun, logHook, readInput, runHook } from './io.mjs';

const THROTTLE_MS = 3000;
const MAX_LINES = 6;
const TS_FAMILY = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$|(?:^|\/)(?:package\.json|tsconfig[^/]*\.json)$/;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

runHook(async () => {
  if (process.env.TS_OPTIMIZE_HOOKS === 'off') return;
  const input = await readInput();
  if (input.agent_type) return; // subagents do not edit
  const open = findOpenRun(input.cwd);
  if (!open) return;
  const run = readJson(join(open.root, '.ts-optimize', 'runs', open.id, 'run.json'));
  if (!run || run.state !== 'applying' || run.fast_check?.enabled === false) return;
  const cfg = readJson(join(open.root, '.ts-optimize', 'config.json'));
  if (cfg?.hooks?.enabled === false || cfg?.hooks?.fast_check === false) return;

  // hint only: when the batch is known to have touched no TypeScript-family file and nothing is pending, there is nothing to check
  const hinted = (input.tool_calls || []).map((c) => c?.tool_input?.file_path).filter((x) => typeof x === 'string');
  const state = join(open.root, '.ts-optimize', 'state', 'fast-check-hook.json');
  const last = readJson(state);
  if (last && Date.now() - last.at < THROTTLE_MS) return;
  if (hinted.length && !hinted.some((f) => TS_FAMILY.test(f)) && last?.fingerprint) return;

  const { worktreeFingerprint } = await import('../gate/fingerprint.mjs');
  const fingerprint = await worktreeFingerprint(open.root);
  if (last?.fingerprint === fingerprint) return; // same tree as the last check: it already spoke (or had nothing to say)

  const { runCheck } = await import('../gate/check.mjs');
  let res;
  try { res = await runCheck({ root: open.root, runId: open.id }); } catch (e) { logHook(open.root, { handler: 'fast-check', error: String(e?.message || e).slice(0, 120) }); return; }
  writeFileSync(state, JSON.stringify({ fingerprint: res.fingerprint, at: Date.now(), passed: res.passed }) + '\n'); // runCheck has already refused a linked artifact tree
  logHook(open.root, { handler: 'fast-check', ms: res.ms, new_errors: res.new_error_count });
  if (res.passed) return;

  const shown = res.new_errors.slice(0, MAX_LINES).map((e) => `${e.file}(${e.line}) ${e.code}: ${String(e.message).replace(/\s+/g, ' ').replace(/\.+$/, '').slice(0, 110)}`);
  const more = res.new_error_count - shown.length;
  const finding = run.applying?.finding;
  const secs = (res.ms / 1000).toFixed(1);
  const text = `ts-optimize fast-check (${res.engine.kind} ${res.engine.version || '?'}, ${secs} s): ${res.new_error_count} NEW error${res.new_error_count === 1 ? '' : 's'} vs baseline — ${shown.join('; ')}${more > 0 ? `; …and ${more} more` : ''}.${finding ? ` ${finding} is in progress;` : ''} transient errors are expected mid-refactor, but \`ts-opt commit\` refuses until clean.`;
  emit({ hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: text.slice(0, 1400) } });
});
