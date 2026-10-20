// .ts-optimize/config.json (optional, committed, human-edited) with defaults (doc 04 §6). Unknown keys are reported, not fatal.
import { join } from 'node:path';
import { isFile, readJsonc } from '../core/fs.mjs';

/** work branch for a run: the configured prefix, except `tsgo` adoption runs (doc 05 §8.4) */
export const workBranch = (config, mode) => (mode === 'tsgo' && config.commit.branch_prefix === DEFAULTS.commit.branch_prefix ? 'chore/upgrade-typescript-go' : config.commit.branch_prefix);

export const DEFAULTS = Object.freeze({
  scope: { include: [], exclude: [] },
  protected: [],
  gate: { typecheck: 'auto', test: 'auto', build: 'auto', timeout_s: { typecheck: 600, test: 1800, build: 1800 }, scope: 'full' },
  thresholds: { cyclomatic: 10, cognitive: 15, function_loc: 60, nesting: 3, params: 4, max_findings_per_domain: 400 },
  commit: { granularity: 'finding', batch_max: 25, no_verify: false, branch_prefix: 'chore/ts-cleanup', artifacts: true },
  hooks: { enabled: true, fast_check: true },
  network: { npx: 'ask', toolbox: 'ask' },
  keep_runs: 5,
});
const KNOWN = new Set(['schema', ...Object.keys(DEFAULTS)]);

const merge = (d, o) => {
  if (o === undefined || o === null) return d;
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof o === 'object' && !Array.isArray(o)) {
    const out = { ...d };
    for (const k of Object.keys(o)) out[k] = k in d ? merge(d[k], o[k]) : o[k];
    return out;
  }
  return o;
};

/** -> { config, warnings[], present, error } */
export function loadConfig(root) {
  const f = join(root, '.ts-optimize', 'config.json');
  if (!isFile(f)) return { config: structuredClone(DEFAULTS), warnings: [], present: false, error: null };
  const r = readJsonc(f);
  if (!r.ok || !r.value || typeof r.value !== 'object') return { config: structuredClone(DEFAULTS), warnings: [`config.json unreadable (${r.error}); using defaults`], present: true, error: r.error };
  const warnings = Object.keys(r.value).filter((k) => !KNOWN.has(k)).map((k) => `config.json: unknown key "${k}" ignored`);
  return { config: merge(structuredClone(DEFAULTS), r.value), warnings, present: true, error: null };
}
