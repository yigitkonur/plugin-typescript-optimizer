// Fast-versus-authoritative divergence (doc 05 §8.2): the authoritative compiler decides every gate; the fast one may only block early or advise.
// Where the fast compiler fails and the authority passes on the same tree, that is logged, and the third time the fast check switches itself off.
import { readRun, stampLog } from '../artifacts/store.mjs';
import { updateRun } from './exec.mjs';

export const MAX_DIVERGENCES = 3;

/** record one divergence; -> {count, disabled} */
export function recordDivergence(root, runId, { wave = null, fast = null } = {}) {
  let out = { count: 0, disabled: false };
  updateRun(root, runId, (r) => {
    const fc = (r.fast_check ||= { enabled: true, divergences: 0 });
    fc.divergences = (fc.divergences || 0) + 1;
    if (fc.divergences >= MAX_DIVERGENCES && fc.enabled !== false) { fc.enabled = false; fc.disabled_reason = 'tsgo-divergence'; }
    out = { count: fc.divergences, disabled: fc.enabled === false && fc.disabled_reason === 'tsgo-divergence' };
  });
  stampLog(root, runId, { ev: 'divergence', fast: 'fail', auth: 'pass', ...(wave ? { wave } : {}), ...(fast ? { first: fast } : {}), count: out.count, ...(out.disabled ? { fast_check: 'disabled' } : {}) });
  return out;
}

export const divergenceNote = (root, runId) => {
  try { const fc = readRun(root, runId).fast_check; return fc?.disabled_reason === 'tsgo-divergence' ? `tsgo-divergence: the fast compiler failed where the authoritative compiler passed ${fc.divergences} times; fast-check switched itself off for this run` : null; } catch { return null; }
};
