// ts-opt check [paths…]: the fast loop; new typecheck errors against the baseline fingerprints (exit 6 when there are any).
import { resolveRunId } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { detect } from '../detect/index.mjs';
import { runCheck } from '../gate/check.mjs';

export const spec = {};

export async function run({ cwd, flags, args }) {
  const d = await detect(cwd);
  if (!d.typescript) throw new TsOptError(EXIT.NOTHING, `No TypeScript found under ${d.root}; nothing to do.`);
  const root = d.root;
  let runId = null;
  try { runId = resolveRunId(root, flags.run); } catch (e) { if (flags.run) throw e; }
  const r = await runCheck({ root, runId, paths: args && args.length ? args : null });
  const L = [`check ${r.passed ? 'ok' : 'FAILED'}: ${r.engine.kind} ${r.engine.version || '?'} in ${r.ms} ms · ${r.new_error_count} new error(s) · ${r.baseline_errors} in baseline`];
  for (const e of r.new_errors.slice(0, 8)) L.push(`  ${e.file}(${e.line}) ${e.code} ${e.message.slice(0, 140)}`);
  if (r.new_errors.length > 8) L.push(`  … ${r.new_errors.length - 8} more`);
  if (!runId) L.push('(no run: every error counts as new)');
  return { result: r, text: L.join('\n'), exit: r.passed ? EXIT.OK : EXIT.GATE, next_actions: r.passed ? [] : [{ cmd: 'ts-opt check', why: 'fix the new errors above, then re-run' }] };
}
