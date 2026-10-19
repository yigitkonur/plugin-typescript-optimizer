// plan.md — the review surface; checkboxes are the approval UI (doc 04 §5).
import { stringifyYaml } from '../core/yaml-subset.mjs';
import { WAVE_ORDER, catalogJson } from '../catalog/index.mjs';

const FALLBACK_NAMES = { R0: 'mechanical lint autofix', R: 'root cause (deep)', 1: 'unreferenced files', 2: 'barrels and cycles', 3: 'encapsulation', B: 'lint bridge', 4: 'types', 5: 'dependencies', T1: 'tsconfig migration', T2: 'tooling bridge', T3: 'compiler switch', T4: 'CI and editor' };
export const waveName = (w) => (catalogJson('waves.json')?.waves || []).find((x) => String(x.id) === String(w))?.name || FALLBACK_NAMES[w] || String(w);

export function eligible(f) {
  return f.verdict === 'confirmed' && f.state === 'open' && f.confidence !== 'speculative' && f.fix_mode !== 'flag-only' && f.wave !== null;
}

export function renderPlan({ run, mode, baseBranch, workBranch, gateLine, gateEstimateMin, findings, notScheduled, rulesById }) {
  const front = stringifyYaml({ schema: 'ts-optimize/plan@1', run, mode, base_branch: baseBranch, work_branch: workBranch, gate_estimate_min: gateEstimateMin ?? null });
  const L = ['---', front.trimEnd(), '---', `# Fix plan — ${mode} mode`, '',
    'Legend: `[x]` approve · `[ ]` skip. `risk` is fix risk. `flag-only` items have no checkbox.', gateLine, ''];
  const byWave = new Map();
  for (const f of findings.filter(eligible)) (byWave.get(f.wave) || byWave.set(f.wave, []).get(f.wave)).push(f);
  for (const w of WAVE_ORDER) {
    const list = byWave.get(w);
    if (!list) continue;
    L.push(`## Wave ${w} — ${waveName(w)}`);
    for (const f of list) {
      const rn = rulesById.get(f.rule)?.name || f.rule;
      L.push(`- [ ] ${f.id} ${f.rule} \`${f.location.file}${f.location.symbol ? '#' + f.location.symbol : ''}\` — ${rn} (risk **${f.fix_risk}**${f.fix_risk === 'high' ? ': needs your decision' : ''}, ${f.fix_mode})`);
    }
    L.push('');
  }
  const rest = findings.filter((f) => !eligible(f) && f.state !== 'superseded');
  if (rest.length || notScheduled.length) {
    L.push('## Not part of any wave', '');
    for (const f of rest) {
      const why = f.fix_mode === 'flag-only' || f.verdict === 'deferred' ? (f.verdict === 'deferred' ? 'deferred: needs your decision' : 'flag-only: suggested change only') : f.confidence === 'speculative' ? 'speculative' : 'wave not schedulable in this mode';
      L.push(`- ${f.id} ${f.rule} \`${f.location.file}${f.location.symbol ? '#' + f.location.symbol : ''}\` — ${rulesById.get(f.rule)?.name || f.rule} (${why})`);
    }
    for (const n of notScheduled) L.push(`- ${n}`);
    L.push('');
  }
  return L.join('\n');
}

/** [{id, checked}] from the checkbox lines of plan.md */
export function parseChecks(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^- \[( |x|X)\] (F-\d{4})\b/.exec(line);
    if (m) out.push({ id: m[2], checked: m[1] !== ' ' });
  }
  return out;
}
