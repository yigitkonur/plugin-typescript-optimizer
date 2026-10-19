// ts-opt suppress <F-id> --reason … [--expires YYYY-MM-DD]: durable triage memory (doc 04 §7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFinding, writeFinding } from '../artifacts/finding.mjs';
import { ART, readRun, resolveRunId, runDir } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, readJsonc, writeAtomic } from '../core/fs.mjs';
import { findRoot } from '../detect/root.mjs';

export const spec = { reason: 'string', expires: 'string' };

export async function run({ cwd, flags, args }) {
  const fid = args[0];
  if (!/^F-\d{4}$/.test(fid || '')) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt suppress F-0001 --reason "why this is not a defect" [--expires YYYY-MM-DD]');
  if (!flags.reason || flags.reason.trim().length < 5) throw new TsOptError(EXIT.USAGE, '--reason is required (say why this finding is not a defect)');
  if (flags.expires && !/^\d{4}-\d{2}-\d{2}$/.test(flags.expires)) throw new TsOptError(EXIT.USAGE, '--expires must be YYYY-MM-DD');
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  const rd = runDir(root, id);
  const fp = join(rd, 'findings', `${fid}.md`);
  if (!isFile(fp)) throw new TsOptError(EXIT.NOTHING, `no finding ${fid} in run ${id}`);
  const run = readRun(root, id);
  if (!['scanning', 'triaging', 'planned', 'ready'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; suppress before the plan is locked`);
  const f = readFinding(fp);
  const supFile = join(root, ART, 'suppressions.json');
  const sup = isFile(supFile) ? readJsonc(supFile).value : null;
  const doc = sup && typeof sup === 'object' ? sup : { schema: 'ts-optimize/suppressions@1', entries: [] };
  doc.entries ||= [];
  const fps = [...new Set([f.front.fingerprint, ...(f.front.candidate_fingerprints || [])])];
  const added = [];
  for (const fpr of fps) {
    if (doc.entries.some((e) => e.fingerprint === fpr)) continue;
    const e = { id: `S-${String(doc.entries.length + 1).padStart(3, '0')}`, fingerprint: fpr, rule: f.front.rule, file: f.front.location.file, reason: flags.reason.trim().slice(0, 300), evidence: [], by: 'user', confirmed_by_user: true, date: nowIso().slice(0, 10), expires: flags.expires || null, codified_in: null };
    doc.entries.push(e); added.push(e.id);
  }
  writeAtomic(supFile, JSON.stringify(doc, null, 2) + '\n');
  // reflect it in this run right away
  const front = { ...f.front, state: 'suppressed', suppressed_by: added[0] || doc.entries.find((e) => e.fingerprint === f.front.fingerprint)?.id || null, wave: null };
  writeFinding(fp, front, f.body);
  const idxFile = join(rd, 'findings', 'index.json');
  const idx = readJsonc(idxFile).value;
  if (idx) { const row = idx.findings.find((x) => x.id === fid); if (row) { row.state = 'suppressed'; row.wave = null; } idx.counts.by_state = {}; for (const x of idx.findings) idx.counts.by_state[x.state] = (idx.counts.by_state[x.state] || 0) + 1; writeAtomic(idxFile, JSON.stringify(idx, null, 2) + '\n'); }
  const planFile = join(rd, 'plan.md');
  if (isFile(planFile)) writeAtomic(planFile, readFileSync(planFile, 'utf8').split('\n').filter((l) => !new RegExp(`^- (\\[[ xX]\\] )?${fid}\\b`).test(l)).join('\n'));
  return { result: { finding: fid, suppressions: added, fingerprints: fps.length }, text: `${fid} suppressed (${added.join(', ') || 'already recorded'}); it will not be re-reported until${flags.expires ? ' ' + flags.expires : ' the entry is deleted from suppressions.json'}` };
}
