// Declaration-emit pre-check for export-pruning findings (reach-04, reach-05): tsc --noEmit never builds the declaration graph,
// so a stripped `export` can pass the fast check and still break `.d.ts` emit (doc 06 type-07 over reach-04/05 seam).
// A new TS40xx/TS2742/TS2883 refuses the commit; the finding is re-expressed as "keep export / register as public".
import { readRun, stampLog } from '../artifacts/store.mjs';
import { getFinding, updateFinding } from './findings.mjs';
import { gateDir, readBaselineDiagnostics } from './baseline.mjs';
import { legDiagnostics, legKey, runLeg } from './exec.mjs';
import { diagFingerprint, diagMultiset, newFingerprints } from './fingerprint.mjs';

export const PRECHECK_RULES = new Set(['reach-04', 'reach-05']);

/** -> {violations:[{rule,detail,paths}], diagnostics:[…], ran:[cwd…]} ; never throws */
export async function declarationPrecheck({ root, runId, findings, changed }) {
  const out = { violations: [], diagnostics: [], ran: [] };
  if (!findings.some((f) => PRECHECK_RULES.has(String(f.front.rule)))) return out;
  const run = readRun(root, runId);
  const legs = (run.gate?.legs || []).filter((l) => l.id === 'declaration-emit');
  if (!legs.length) return out;
  const files = changed.map((c) => c.path);
  const bd = readBaselineDiagnostics(root, runId);
  for (const l of legs.filter((x) => !x.cwd || x.cwd === '.' || files.some((f) => f.startsWith(x.cwd + '/')))) {
    const r = await runLeg(l, { root, wave: null, outDir: gateDir(root, runId), probe: true });
    if (r.status === 'unavailable' || r.status === 'not-applicable') continue;
    out.ran.push(l.cwd || '.');
    if (r.status !== 'fail') continue;
    const diags = legDiagnostics(l, r);
    const fresh = newFingerprints(bd?.authoritative?.by_leg?.[legKey(l)] || {}, diagMultiset(diags, root));
    if (!fresh.length) continue;
    const fps = new Set(fresh.map((x) => x.fingerprint));
    const shown = diags.filter((d) => fps.has(diagFingerprint(d, root)));
    const list = (shown.length ? shown : diags).slice(0, 4);
    out.diagnostics.push(...list);
    out.violations.push({
      rule: 'declaration-emit',
      detail: `declaration emit of ${l.cwd || '.'} breaks after this edit (${fresh.length} new diagnostic(s)): ${list.map((d) => `${d.file}(${d.line}) ${d.code} ${String(d.message).slice(0, 110)}`).join('; ')}. A type reachable from an exported signature is public API: keep the export (register it as an intentional public export) or annotate the signature. Undo the edit, the finding is recorded as "keep export".`,
      paths: list.map((d) => d.file),
    });
  }
  return out;
}

/** record the evidence on the finding and take it out of the apply set */
export function reexpressKeepExport(root, runId, fid, violations) {
  const text = ['- not applied: the declaration-emit pre-check failed, so the export is part of the package\'s public surface.', ...violations.map((v) => `- ${v.detail}`), '- re-expressed as: keep export / register as an intentional public export (see the declaration-emit skill).'].join('\n');
  const f = getFinding(root, runId, fid);
  updateFinding(root, runId, fid, (fm) => { fm.state = 'skipped'; fm.triage = { ...(fm.triage || {}), public_contract: 'yes' }; }, text);
  stampLog(root, runId, { ev: 'precheck-refused', id: fid, rule: f.front.rule, kind: 'declaration-emit', violations: violations.length });
}
