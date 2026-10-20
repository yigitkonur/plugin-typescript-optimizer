// codebase-health.md (deep mode, doc 04 §10): the architect's proposals with badges, the Deletion/Seam Test results and the
// Mermaid before/after of every STRONG one. Regenerated from raw/proposals/*.json each time a proposal is recorded.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runDir } from './store.mjs';
import { mkdirp, readJsonc, writeAtomic } from '../core/fs.mjs';

const BADGE = { STRONG: '[STRONG]', WORTH_EXPLORING: '[WORTH EXPLORING]', SPECULATIVE: '[SPECULATIVE]' };

export const proposalsDir = (root, runId) => join(runDir(root, runId), 'raw', 'proposals');

export function saveProposal(root, runId, p) {
  mkdirp(proposalsDir(root, runId));
  writeAtomic(join(proposalsDir(root, runId), `${p.id}.json`), JSON.stringify(p, null, 2) + '\n');
}

export function loadProposals(root, runId) {
  const dir = proposalsDir(root, runId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^F-\d+\.json$/.test(f)).sort().map((f) => readJsonc(join(dir, f)).value).filter(Boolean);
}

export function renderHealth({ runId, mode, churn, proposals }) {
  const L = ['---', 'schema: ts-optimize/health@1', `run: ${runId}`, `mode: ${mode}`, '---', '# Codebase health (deep mode)', ''];
  L.push(`Scope and churn window: ${churn?.window || 'not recorded'}${churn?.cold_excluded != null ? `; ${churn.cold_excluded} cold module(s) excluded (no commits in the window: never proposed)` : ''}.`, '');
  const hot = churn?.hot || [];
  if (hot.length) {
    L.push('## Hot spots', '', '| Module | Commits | Importers | LOC | Engine candidates |', '|---|---|---|---|---|');
    for (const m of hot.slice(0, 15)) L.push(`| \`${m.file}\` | ${m.commits} | ${m.importer_count} | ${m.loc} | ${(m.candidates || []).map((c) => c.rule).join(', ') || '-'} |`);
    L.push('');
  }
  const order = ['STRONG', 'WORTH_EXPLORING', 'SPECULATIVE'];
  const sorted = [...proposals].sort((a, b) => order.indexOf(a.recommendation) - order.indexOf(b.recommendation) || a.id.localeCompare(b.id));
  L.push('## Proposals', '');
  if (!sorted.length) L.push('No structural proposals: nothing in the hot modules passed the Deletion Test and Seam Test.', '');
  for (const p of sorted) {
    L.push(`### ${BADGE[p.recommendation] || p.recommendation} ${p.rule} — \`${p.file}:${p.line}\` ([${p.id}](findings/${p.id}.md))`, '');
    if (p.deletion_test) L.push(`- Deletion Test: ${p.deletion_test}`);
    if (p.seam_test) L.push(`- Seam Test: ${p.seam_test}`);
    if (p.touches?.length) L.push(`- Touches (${p.touches.length}): ${p.touches.map((t) => '`' + t + '`').join(', ')}`);
    if (p.plan_steps?.length) { L.push('- Plan:'); p.plan_steps.forEach((s, i) => L.push(`  ${i + 1}. ${s}`)); }
    L.push(`- Schedule: ${p.recommendation === 'STRONG' && p.wave ? `wave ${p.wave} (needs your approval in plan.md)` : 'not scheduled; a suggestion for people'}`);
    if (p.mermaid) L.push('', '```mermaid', p.mermaid.trim(), '```');
    L.push('');
  }
  return L.join('\n');
}

export function writeHealth(root, runId, mode) {
  const churn = readJsonc(join(runDir(root, runId), 'raw', 'churn.json')).value || null;
  writeAtomic(join(runDir(root, runId), 'codebase-health.md'), renderHealth({ runId, mode, churn, proposals: loadProposals(root, runId) }));
}
