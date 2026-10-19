// SUMMARY.md — human dashboard (doc 04 §9). Generated only by `findings ingest` / `run finish`.
import { DOMAIN_ORDER, WAVE_ORDER } from '../catalog/index.mjs';
import { eligible, waveName } from './plan.mjs';

const SEV_W = { hard: 100, warn: 10, advisory: 1 };
const CONF_W = { certain: 1.0, likely: 0.6, speculative: 0.3 };
const RISK_W = { low: 1, medium: 2, high: 4 };
export const scoreOf = (f) => (SEV_W[f.severity] * (CONF_W[f.confidence] ?? 0.6)) / RISK_W[f.fix_risk];

export function renderSummary(ctx) {
  const { run, findings, dismissed, suppressedCount, overflow, degraded, domainsRun, detect, agentSuppressions, notes, rulesById, gateLine, mode } = ctx;
  const live = findings.filter((f) => f.state !== 'superseded');
  const count = (fn) => live.filter(fn).length;
  const L = [];
  const g = run.repo;
  L.push(`# ts-optimize audit ${run.id}`, '', `mode **${mode}** · head \`${g.head || 'n/a'}\` on \`${g.branch || 'n/a'}\`${g.dirty ? ' (dirty tree)' : ''} · plugin ${run.plugin_version}`, '');
  const blocked = !detect.gate.legs.some((l) => l.id === 'typecheck');
  const verdictLine = blocked ? 'BLOCKED: no typecheck leg — the audit is readable but fix cannot run' : live.length ? 'READY FOR REVIEW' : 'CLEAN: no findings in the audited scope';
  L.push(`## Verdict: ${verdictLine}`, '');
  L.push('Gate-time estimate: unknown until `run begin` measures it (an audit does not run tests or builds).', '');

  L.push('## Coverage', '', '| Domain | Status |', '|---|---|');
  for (const d of DOMAIN_ORDER) {
    const ran = domainsRun.includes(d);
    const deg = degraded.filter((x) => x.domain === d);
    L.push(`| ${d} | ${!ran ? 'not requested in this mode' : deg.length ? 'degraded — ' + deg.map((x) => `${x.part}: ${x.reason}`).join('; ') : 'audited'} |`);
  }
  L.push('');

  L.push('## Rollups', '');
  L.push(`- by severity: hard ${count((f) => f.severity === 'hard')} · warn ${count((f) => f.severity === 'warn')} · advisory ${count((f) => f.severity === 'advisory')}`);
  L.push('- by domain: ' + DOMAIN_ORDER.map((d) => `${d} ${count((f) => f.domain === d)}`).join(' · '));
  L.push('- by wave: ' + [...WAVE_ORDER, null].map((w) => [w, count((f) => f.wave === w)]).filter(([, n]) => n).map(([w, n]) => `${w === null ? 'unscheduled' : w + ' ' + waveName(w)} ${n}`).join(' · '));
  L.push(`- by fix mode: auto ${count((f) => f.fix_mode === 'auto')} · assisted ${count((f) => f.fix_mode === 'assisted')} · flag-only ${count((f) => f.fix_mode === 'flag-only')}`);
  L.push(`- eligible for approval: ${count(eligible)} · dismissed as false positives: ${dismissed.length} · suppressed: ${suppressedCount} · over the per-domain cap: ${overflow.length}`, '');

  const decide = live.filter((f) => f.fix_risk === 'high' || f.fix_mode === 'flag-only' || f.verdict === 'deferred');
  L.push(`## Needs your decision (${decide.length})`, '');
  for (const f of decide.slice(0, 40)) L.push(`- ${f.id} ${f.rule} \`${f.location.file}\` — ${f.verdict === 'deferred' ? 'deferred' : f.fix_mode === 'flag-only' ? 'flag-only' : 'fix risk high'}`);
  if (decide.length > 40) L.push(`- … and ${decide.length - 40} more (see plan.md)`);
  L.push('');

  const top = [...live].sort((a, b) => scoreOf(b) - scoreOf(a) || a.location.file.localeCompare(b.location.file)).slice(0, 10);
  L.push('## Top 10 by score', '');
  for (const f of top) L.push(`- ${f.id} \`${f.rule}\` ${f.severity}/${f.fix_risk}/${f.confidence} — [\`${f.location.file}:${f.location.line}\`](findings/${f.id}.md)`);
  L.push('');

  if (agentSuppressions.length) {
    L.push('## Agent-made suppressions — delete a line in suppressions.json to re-triage', '');
    for (const s of agentSuppressions) L.push(`- ${s.id} ${s.rule} \`${s.file}\` — ${s.reason}`);
    L.push('');
  }
  if (notes.length) L.push('## Notes', '', ...notes.map((n) => `- ${n}`), '');
  L.push('## Gate', '', gateLine, '');
  if (degraded.length) { L.push('## Degradations and capability gaps', ''); for (const x of degraded) L.push(`- [${x.domain}] ${x.part}: ${x.reason}`); L.push(''); }
  L.push('Review `plan.md`, tick the boxes you accept, then run `/ts-optimize:fix`.', '');
  return L.join('\n');
}
