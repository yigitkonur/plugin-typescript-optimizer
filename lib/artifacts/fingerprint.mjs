// Finding fingerprint (doc 04 §3.4): stable across runs; line numbers are deliberately excluded.
import { sha1 } from '../core/hash.mjs';

const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** occ = ordinal among otherwise-identical candidates of the same rule in the same file (copy-pasted code), 0 for the first */
export function fingerprintOf(c, occ = 0) {
  const anchor = c.symbol ? '' : collapse(c.snippet);
  const parts = [c.rule, c.package || '.', String(c.file || '').split('\\').join('/'), c.symbol || '', anchor];
  if (occ > 0) parts.push(String(occ));
  return 'sha1:' + sha1(parts.join('\0'));
}

/** assigns fingerprints to a sorted candidate list, disambiguating exact duplicates by their order in the file */
export function assignFingerprints(cands) {
  const seen = new Map();
  for (const c of cands) {
    const base = fingerprintOf(c, 0);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    c.fingerprint = n === 0 ? base : fingerprintOf(c, n);
  }
}
