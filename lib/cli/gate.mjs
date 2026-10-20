// ts-opt gate [--wave id] [--legs csv] [--quiet]: the authoritative gate for a wave (exit 6 when a required leg fails).
import { readRun, resolveRunId } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { detect } from '../detect/index.mjs';
import { runGate } from '../gate/gate.mjs';

export const spec = { wave: 'string', legs: 'array' };

export async function run({ cwd, flags }) {
  const d = await detect(cwd);
  if (!d.typescript) throw new TsOptError(EXIT.NOTHING, `No TypeScript found under ${d.root}; nothing to do.`);
  const root = d.root;
  const runId = resolveRunId(root, flags.run);
  const wave = String(flags.wave || readRun(root, runId).applying?.wave || 'P');
  const r = await runGate({ root, runId, wave, legs: flags.legs || null, quiet: !!flags.quiet });
  const L = [`gate wave ${r.wave}: ${r.passed ? 'PASSED' : 'FAILED'} in ${Math.round(r.ms / 100) / 10}s (run ${runId})`];
  for (const [id, l] of Object.entries(r.legs)) {
    const extra = l.reason ? ` ${l.reason}` : l.new_fingerprints?.length ? ` ${l.new_fingerprints.length} new error(s)` : '';
    L.push(`  ${id.padEnd(16)} ${l.status.padEnd(14)} ${l.ms} ms${l.flaky ? ' · flaky' : ''}${l.variant ? ' · ' + l.variant : ''}${extra}`);
  }
  for (const [id, l] of Object.entries(r.legs)) for (const n of (l.new_fingerprints || []).slice(0, 3)) L.push(`  new: ${n.file}(${n.line}) ${n.code} ${n.message.slice(0, 110)}`);
  if (r.tree_changed) L.push('note: the working tree changed while the gate ran');
  const next = r.passed ? [] : [{ cmd: `ts-opt bisect --wave ${r.wave}`, why: `leg(s) failed: ${(r.failed_legs || []).join(', ')}; find the culprit finding commit` }];
  return { result: { run: runId, ...r }, text: L.slice(0, 12).join('\n'), exit: r.passed ? EXIT.OK : EXIT.GATE, next_actions: next };
}
