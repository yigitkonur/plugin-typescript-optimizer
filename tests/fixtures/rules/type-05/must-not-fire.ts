// customer?.profile?.billing?.tier in a comment, and if (a && a.b) too, and x ?? null
export const doc = 'customer?.profile?.billing?.tier ?? null';
export const one = (c: { p?: { q?: string } }) => c.p?.q;
export const two = (c: { p?: { q?: { r: string } } }) => c.p?.q?.r;
export const nullable = (v: string | undefined) => v ?? nullableDefault;
declare const nullableDefault: string;
export async function load(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  return data?.items?.[0]?.owner?.login ?? data?.owner?.profile?.name?.first;
}
export function fromText(raw: string) {
  const cfg = JSON.parse(raw);
  if (cfg && cfg.enabled) return cfg?.a?.b?.c;
  return cfg.fallback ?? null;
}
