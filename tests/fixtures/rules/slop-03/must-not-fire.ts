export type IsString<T> = T extends string ? true : false;
export type IsObj<T> = T extends { a: 1 } ? true : false;
export const a = flag ? 'yes' : 'no';
export const b = x ? true : y;
export function c(a: number) {
  if (a > 1) { return true; }
  return compute(a);
}
export function d(a: number) {
  if (a > 1) { log(a); return true; }
  return false;
}
export function e(a: number) { if (a) return true; else return true; }
export interface O { ok?: true; flag: boolean }
export const f1 = !x;
export const g1 = Boolean(x);
export const h1 = (p: number) => p === q;
export const i1 = (p: number) => p > 1;
// const z = flag ? true : false;
const s = 'a === true';
const t = `b ? true : false`;
export const j1 = { done: true, failed: false };
export const k1 = (v: unknown) => !!v && typeof v === 'object';
export const l1 = (o?: { ok?: boolean; c?: { d?: boolean } }) => o?.ok !== false && o?.c?.d === true;
export function ef(code: number) {
  if (code < 0) { return 0; } else if (code > 9) return false;
  return true;
}
