// Time source with an override so tests and goldens are deterministic.
export function nowDate() {
  const o = process.env.TS_OPT_NOW;
  return o ? new Date(o) : new Date();
}
export function nowIso() { return nowDate().toISOString(); }
// 2026-10-19T1432Z (run ids use minute precision + a short suffix)
export function runStamp(d = nowDate()) {
  return d.toISOString().slice(0, 16).replace(':', '') + 'Z';
}
