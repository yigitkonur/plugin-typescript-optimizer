// ts-opt findings ingest|list|show|stale-check|skip
import { join } from 'node:path';
import { readFinding } from '../artifacts/finding.mjs';
import { ingest } from '../artifacts/ingest.mjs';
import { loadConfig } from '../artifacts/config.mjs';
import { readRun, resolveRunId, runDir, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { readJsonc } from '../core/fs.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { staleCheck } from '../artifacts/stale.mjs';
import { getFinding, liveIndexRows, updateFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { isFile, writeAtomic } from '../core/fs.mjs';

export const spec = { wave: 'string', state: 'string', rule: 'string', domain: 'string', reason: 'string' };

export async function run({ cwd, flags, args }) {
  const sub = args[0];
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  if (sub === 'ingest') {
    const runObj = readRun(root, id);
    if (!['scanning', 'triaging', 'planned'].includes(runObj.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; ingest only works before the plan is locked`);
    const d = await detect(root);
    const { config } = loadConfig(root);
    const r = ingest({ root, runId: id, detect: d, run: runObj, config, mode: runObj.mode });
    return { result: r, text: `${r.findings} findings (${r.by_severity.hard} hard · ${r.by_severity.warn} warn · ${r.by_severity.advisory} advisory), ${r.eligible} eligible for approval, ${r.dismissed} dismissed, ${r.suppressed} suppressed, ${r.superseded} superseded, ${r.overflow} over cap\nneeds your decision: ${r.needs_decision}\n${r.summary}\n${r.plan}`, next_actions: [{ cmd: 'ts-opt validate', why: 'check the generated artifacts' }] };
  }
  if (sub === 'stale-check') {
    const r = await staleCheck(root, id, { apply: true });
    return { result: r, text: r.stale.length ? `stale (files changed since the audit): ${r.stale.map((x) => `${x.id} (${x.files.join(', ')})`).join('; ')}` : `no stale findings (${r.checked} checked)` };
  }
  if (sub === 'skip') return withRunLock(root, id, 'findings skip', () => skip(root, id, args[1], flags.reason));
  const index = readJsonc(join(runDir(root, id), 'findings', 'index.json'));
  if (!index.ok) throw new TsOptError(EXIT.NOTHING, `run ${id} has no findings yet (run \`ts-opt findings ingest\`)`);
  if (sub === 'list') {
    let list = liveIndexRows(root, id, index.value.findings);
    if (flags.wave) list = list.filter((f) => String(f.wave) === flags.wave);
    if (flags.state) list = list.filter((f) => f.state === flags.state);
    if (flags.rule) list = list.filter((f) => f.rule === flags.rule);
    if (flags.domain) list = list.filter((f) => f.domain === flags.domain);
    return { result: { findings: list }, text: list.map((f) => `${f.id} ${f.rule.padEnd(9)} wave ${String(f.wave).padEnd(4)} ${f.severity.padEnd(8)} ${f.fix_risk.padEnd(6)} ${f.state.padEnd(10)} ${f.file}:${f.line}`).join('\n') || '(none)' };
  }
  if (sub === 'show') {
    const fid = args[1];
    if (!fid) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt findings show F-0001');
    const fp = join(runDir(root, id), 'findings', `${fid}.md`);
    let f; try { f = readFinding(fp); } catch { throw new TsOptError(EXIT.NOTHING, `no finding ${fid}`); }
    return { result: { front: f.front, sections: f.sections }, text: f.body };
  }
  throw new TsOptError(EXIT.USAGE, 'usage: ts-opt findings ingest|list|show|stale-check|skip');
}

/** while applying: a finding the audit got wrong (a consumer it missed) is taken out of the apply set with its evidence; nothing is edited */
function skip(root, id, fid, reason) {
  if (!/^F-\d{4,}$/.test(fid || '') || !String(reason || '').trim()) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt findings skip F-0007 --reason "what you found (file:line of the consumer the audit missed)"');
  const run = readRun(root, id);
  if (!['locked', 'applying', 'verifying'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; before the lock, untick the box in plan.md instead`);
  const f = getFinding(root, id, fid);
  if (!['approved', 'open'].includes(f.front.state)) throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}; only an approved finding, or a cascade/proposal still waiting for approval, can be skipped`);
  const why = String(reason).replace(/\s+/g, ' ').trim().slice(0, 400);
  updateFinding(root, id, fid, (fm) => { fm.state = 'skipped'; }, `- skipped while applying (nothing was edited): ${why}`);
  const idxFile = join(runDir(root, id), 'findings', 'index.json');
  if (isFile(idxFile)) {
    const idx = readJsonc(idxFile).value;
    for (const r of idx.findings) if (r.id === fid) r.state = 'skipped';
    idx.counts.by_state = {}; for (const r of idx.findings) idx.counts.by_state[r.state] = (idx.counts.by_state[r.state] || 0) + 1;
    writeAtomic(idxFile, JSON.stringify(idx, null, 2) + '\n');
  }
  stampLog(root, id, { ev: 'skip', id: fid, reason: why });
  return { result: { id: fid, state: 'skipped', reason: why }, text: `${fid} skipped: ${why}` };
}
