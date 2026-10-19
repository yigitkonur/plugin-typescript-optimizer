import { createHash } from 'node:crypto';
export const sha1 = (s) => createHash('sha1').update(s).digest('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// JSON with sorted keys: stable input for hashes and byte-identical artifacts.
export function stableStringify(v, space) {
  return JSON.stringify(sortKeys(v), null, space);
}
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
