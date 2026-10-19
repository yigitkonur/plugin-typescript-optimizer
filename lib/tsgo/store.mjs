// .ts-optimize/fit/latest/{fit.json,tsgo-fit.md}: written by `ts-opt fit`, imported by `scan --mode tsgo` when fresh (doc 05 §8.3).
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ensureArtifactRoot } from '../artifacts/store.mjs';
import { isFile, readJsonc, writeAtomic } from '../core/fs.mjs';

export const FIT_MAX_AGE_MS = 60 * 60 * 1000;
export const fitDir = (root) => join(root, '.ts-optimize', 'fit', 'latest');

/** write both files; throws TsOptError (capability) when the checkout is not writable */
export function saveFit(root, fit, reportMd) {
  ensureArtifactRoot(root);
  const dir = fitDir(root);
  writeAtomic(join(dir, 'fit.json'), JSON.stringify(fit, null, 2) + '\n');
  writeAtomic(join(dir, 'tsgo-fit.md'), reportMd.endsWith('\n') ? reportMd : reportMd + '\n');
  return { json: '.ts-optimize/fit/latest/fit.json', report: '.ts-optimize/fit/latest/tsgo-fit.md' };
}

/**
 * Read the stored fit result. -> { fit|null, fresh, age_ms, reason }
 * fresh = younger than maxAgeMs AND recorded for the same HEAD (both null counts as the same, for repositories without commits)
 * AND none of the `watch` files (repo-relative tsconfig/package.json paths) was modified after it was written.
 */
export function loadLatestFit(root, { head = null, maxAgeMs = FIT_MAX_AGE_MS, now = Date.now(), watch = [] } = {}) {
  const f = join(fitDir(root), 'fit.json');
  if (!isFile(f)) return { fit: null, fresh: false, age_ms: null, reason: 'no stored fit result' };
  const r = readJsonc(f);
  if (!r.ok || !r.value || r.value.schema !== 'ts-optimize/fit@1') return { fit: null, fresh: false, age_ms: null, reason: 'stored fit result is unreadable' };
  const t = Date.parse(r.value.generated);
  const age = Number.isFinite(t) ? now - t : null;
  if (age === null || age < 0 || age > maxAgeMs) return { fit: r.value, fresh: false, age_ms: age, reason: age === null ? 'stored fit result has no timestamp' : 'stored fit result is older than one hour' };
  if ((r.value.head ?? null) !== (head ?? null)) return { fit: r.value, fresh: false, age_ms: age, reason: `stored fit result is for HEAD ${r.value.head ?? 'none'}, current HEAD is ${head ?? 'none'}` };
  for (const w of watch) { try { if (statSync(join(root, w)).mtimeMs > t) return { fit: r.value, fresh: false, age_ms: age, reason: `${w} changed after the stored fit result` }; } catch { /* file gone: ignore */ } }
  return { fit: r.value, fresh: true, age_ms: age, reason: null };
}
