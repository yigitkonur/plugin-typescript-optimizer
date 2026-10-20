// ts-opt baseline [--legs csv] [--allow-red-baseline csv] [--save]: run the required legs before any edit and capture what green means.
import { resolveRunId } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { detect } from '../detect/index.mjs';
import { captureBaseline } from '../gate/baseline.mjs';

export const spec = { legs: 'array', 'allow-red-baseline': 'array', save: 'boolean' };

export async function run({ cwd, flags }) {
  const d = await detect(cwd);
  if (!d.typescript) throw new TsOptError(EXIT.NOTHING, `No TypeScript found under ${d.root}; nothing to do.`);
  const root = d.root;
  const runId = resolveRunId(root, flags.run);
  const r = await captureBaseline({ root, runId, detect: d, save: !!flags.save, legs: flags.legs || null, allowRed: flags['allow-red-baseline'] || [] });
  const L = [`baseline ${r.status} (run ${runId}) in ${Math.round(r.timings.total_ms / 100) / 10}s`];
  for (const l of r.legs) L.push(`  ${l.id.padEnd(16)} ${l.status.padEnd(14)} ${l.status === 'not-applicable' || l.status === 'unavailable' ? (l.reason || '') : `${l.ms} ms${l.variant ? ' · ' + l.variant : ''}${l.flaky ? ' · flaky' : ''}${l.errors ? ' · ' + l.errors + ' error(s)' : ''}`}${l.cwd && l.cwd !== '.' ? ` [${l.cwd}]` : ''}`);
  L.push(`diagnostics: ${r.authoritative.engine} ${r.authoritative.count} error(s)${r.fast ? ` · ${r.fast.engine} ${r.fast.count} (${r.fast.ms} ms)` : ''}`);
  const m = r.metrics;
  if (m.type_soundness) L.push(`type soundness: ${m.type_soundness.metric} = ${m.type_soundness.value}`);
  if (m.knip && !m.knip.unavailable) L.push(`knip: ${m.knip.files} files, ${m.knip.exports} exports, ${m.knip.types} types, ${m.knip.dependencies} deps; cycles ${m.cycles?.count ?? '?'}`);
  L.push(`schedulable waves: ${r.schedulable_waves.join(', ') || 'none'}${r.schedulable_waves.length && r.schedulable_waves.length <= 2 && !r.legs.some((l) => l.id === 'test' && l.status === 'pass') ? ' (no usable test suite: only zero-runtime type waves B and 4)' : ''}`);
  if (r.saved) L.push(`saved ${r.saved}`);
  for (const w of r.warnings) L.push(`warning: ${w}`);
  return { result: { run: runId, ...r }, text: L.join('\n'), exit: EXIT.OK, warnings: r.warnings, next_actions: r.status === 'red' ? [{ cmd: 'ts-opt gate --wave P', why: 'red baseline accepted: legs pass while they add no new fingerprint' }] : [] };
}
