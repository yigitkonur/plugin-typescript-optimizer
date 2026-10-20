// ts-opt rescan --wave <id>: after a wave, re-run the producing engine (Knip). Pending findings whose evidence vanished go stale;
// new reports caused by the wave become cascade findings that need their own approval (doc 06 §3 "Cascade rule").
import { join } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { addFinding } from '../artifacts/newfinding.mjs';
import { readRun, resolveRunId, runDir, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, readJsonc, readText, writeAtomic } from '../core/fs.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { readLog } from '../gate/bisect.mjs';
import { listFindings, updateFinding } from '../gate/findings.mjs';
import { freshEngineCandidates } from './scan.mjs';

export const spec = { wave: 'string' };
const KNIP_RULES = new Set(['reach-01', 'reach-02', 'reach-03', 'reach-04', 'reach-05', 'reach-09', 'struct-02']);

export async function run({ cwd, flags }) {
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  const runObj = readRun(root, id);
  if (!['applying', 'verifying'].includes(runObj.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; rescan happens between waves of an applying run`);
  const wave = flags.wave || runObj.applying?.wave;
  const d = await detect(root);
  const { config } = loadConfig(root);
  const { fresh, p: produced } = await freshEngineCandidates({ root, d, config, run: runObj, engName: 'knip' });
  // no evidence is not evidence of absence: when the engine did not run cleanly, nothing is marked stale and no cascade is invented
  const badPass = (produced.engineNotes?.knip?.passes || []).filter((x) => !x.ok);
  const engineFailed = (produced.degraded || []).length > 0 || badPass.length > 0;
  if (engineFailed) {
    const why = [...(produced.degraded || []).map((x) => x.reason), ...badPass.map((x) => x.reason || `knip ${x.label} failed`)].filter(Boolean).slice(0, 3).join('; ') || 'engine did not run cleanly';
    stampLog(root, id, { ev: 'rescan', wave: String(wave), skipped: why });
    return { result: { wave: String(wave), new_cascades: [], stale: [], skipped: why }, text: `rescan after wave ${wave} skipped: ${why}\nno finding was changed (an engine failure is not evidence that findings vanished)`, warnings: [`rescan skipped: ${why}`] };
  }
  const freshFps = new Set(fresh.map((c) => c.fingerprint));
  const findings = listFindings(root, id);
  const known = new Set(findings.flatMap((f) => [f.front.fingerprint, ...(f.front.candidate_fingerprints || [])]));

  // 1. pending findings whose evidence vanished -> stale (the wave already fixed them or made them moot)
  const stale = [];
  for (const f of findings) {
    if (!['open', 'approved'].includes(f.front.state) || !KNIP_RULES.has(f.front.rule)) continue;
    const fps = f.front.candidate_fingerprints?.length ? f.front.candidate_fingerprints : [f.front.fingerprint];
    if (fps.length && fps.every((x) => !freshFps.has(x))) { updateFinding(root, id, f.id, (fm) => { fm.state = 'stale'; }); stale.push(f.id); }
  }
  // 2. newly reported candidates -> cascade findings (grouped per rule+file for file-grain rules)
  // the finding committed last in this wave (log order, not id order) is the likeliest cause
  const committed = readLog(root, id).filter((e) => e.ev === 'commit' && String(e.wave) === String(wave)).flatMap((e) => e.ids || []);
  const stillApplied = new Set(findings.filter((f) => f.front.state === 'applied').map((f) => f.id));
  const lastApplied = committed.filter((x) => stillApplied.has(x)).pop() || [...stillApplied].pop() || 'F-0000';
  const groups = new Map();
  for (const c of fresh) {
    if (known.has(c.fingerprint) || !KNIP_RULES.has(c.rule)) continue;
    const k = c.grain === 'file' && c.symbol ? `${c.rule}\0${c.file}` : c.fingerprint;
    (groups.get(k) || groups.set(k, []).get(k)).push(c);
  }
  const created = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.line - b.line);
    const c = list[0];
    const members = list.length > 1 || (c.grain === 'file' && c.symbol) ? list.slice(0, 50).map((x) => ({ line: x.line, symbol: x.symbol })) : [];
    const front = addFinding({
      root, runId: id, detect: d, cand: { ...c, symbol: list.length > 1 ? null : c.symbol, fingerprint: c.fingerprint }, allFingerprints: list.map((x) => x.fingerprint), origin: `cascade:${lastApplied}`, touches: [...new Set(list.flatMap((x) => x.consumers || []))],
      reason: `reported by the engine only after wave ${wave}; likely a consequence of ${lastApplied}`, evidence: [`rescan after wave ${wave}: ${list.map((x) => x.symbol || x.file).join(', ')} newly reported`], members,
    });
    created.push(front.id);
  }
  stampLog(root, id, { ev: 'rescan', wave: String(wave), new_cascades: created, stale });
  return { result: { wave: String(wave), new_cascades: created, stale }, text: `rescan after wave ${wave}: ${created.length} cascade finding(s)${created.length ? ' (' + created.join(', ') + ') need approval: ts-opt plan amend --cascade' : ''}, ${stale.length} finding(s) went stale${stale.length ? ' (' + stale.join(', ') + ')' : ''}`, next_actions: created.length ? [{ cmd: 'ts-opt plan amend --cascade', why: 'approve the cascade findings (ask the user first)' }] : [] };
}
export { isFile, join, readJsonc, readText, runDir, writeAtomic };
