// plan.md — the review surface; checkboxes are the approval UI (doc 04 §5).
import { stringifyYaml } from '../core/yaml-subset.mjs';
import { WAVE_ORDER, catalogJson } from '../catalog/index.mjs';

const FALLBACK_NAMES = { R0: 'mechanical lint autofix', R: 'root cause (deep)', 1: 'unreferenced files', 2: 'barrels and cycles', 3: 'encapsulation', B: 'lint bridge', 4: 'types', 5: 'dependencies', T1: 'tsconfig migration', T2: 'tooling bridge', T3: 'compiler switch', T4: 'CI and editor' };
export const waveName = (w) => (catalogJson('waves.json')?.waves || []).find((x) => String(x.id) === String(w))?.name || FALLBACK_NAMES[w] || String(w);

export function eligible(f) {
  return f.verdict === 'confirmed' && f.state === 'open' && f.confidence !== 'speculative' && f.fix_mode !== 'flag-only' && f.wave !== null;
}

export function renderPlan({ run, mode, baseBranch, workBranch, gateLine, gateEstimateMin, findings, notScheduled, rulesById, lintUsable = true }) {
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
    if (w === '3' && !byWave.has('B') && bridgeSchedulable(mode)) {
      L.push(`## Wave B — ${waveName('B')}`, lintUsable
        ? '- no checkbox: created by the run after wave 3 from the unused-local residue (`tsc --noUnusedLocals`), fixed by the project\'s own lint autofix, covered by the approval of wave 3'
        : '- no checkbox: no usable lint engine, so the unused-local residue left by wave 3 is handled by assisted edits inside the files wave 3 changed (covered by the approval of wave 3)', '');
    }
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

/** wave B is created by the run (not by an audit rule); it is schedulable wherever the catalog lists the mode */
export function bridgeSchedulable(mode) {
  const w = (catalogJson('waves.json')?.waves || []).find((x) => x.id === 'B');
  return !w || !w.modes || w.modes.includes(mode);
}

/**
 * run.waves: waves that have approved findings, plus the implicit bridge `B` when wave 3 has approved work.
 * `states` is Map(findingId -> state) with the post-lock states; entries keep prior bookkeeping (status, tag, gate) across amendments.
 * A wave that receives approved findings after a later wave already ran (a cascade), or after its own gate, is `late`: it runs
 * after the regular waves (the repeat pass), never in front of work that already happened.
 */
export function buildWaves(findings, states, mode, prior = []) {
  const approved = findings.filter((f) => (states.get(f.id) ?? f.front.state) === 'approved');
  const count = (w) => approved.filter((f) => String(f.front.wave) === w).length;
  const keep = new Map(prior.map((w) => [String(w.id), w]));
  const started = prior.filter((w) => ['running', 'gated'].includes(w.status)).map((w) => WAVE_ORDER.indexOf(String(w.id)));
  const furthest = started.length ? Math.max(...started) : -1;
  const implicitB = count('3') > 0 && count('B') === 0 && bridgeSchedulable(mode);
  return WAVE_ORDER.filter((w) => count(w) > 0 || keep.has(w) || (w === 'B' && implicitB)).map((w) => {
    const old = keep.get(w);
    const entry = { ...(old || { status: 'pending', tag: null, gate: null }), id: w, findings: count(w) };
    if (count(w) === 0 && !old) entry.implicit = true;
    if (old && count(w) > 0) entry.findings = Math.max(old.findings || 0, count(w));
    const behind = old ? old.status === 'gated' && approved.some((f) => String(f.front.wave) === w && f.front.state !== 'applied') : WAVE_ORDER.indexOf(w) < furthest;
    if (behind && !old?.late) entry.late = true;
    return entry;
  });
}
