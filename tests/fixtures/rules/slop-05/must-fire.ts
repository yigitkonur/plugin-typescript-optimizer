export async function run() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise(r => setTimeout(r, 500));
  await new Promise<void>((res) => {
    setTimeout(res, 1000);
  });
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);
export function render(items: string[]) {
  function truncate(s: string) { return s.slice(0, 10); }
  return items.map(truncate);
}
