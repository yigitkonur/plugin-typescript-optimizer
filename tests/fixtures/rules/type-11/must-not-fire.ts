declare function run(): void; declare const logger: { error(m: string): void };
export function a() {
  try { run(); } catch (e: unknown) { logger.error(e instanceof Error ? e.message : String(e)); }
}
export function b() {
  try { run(); } catch (e) { throw new Error('ctx', { cause: e }); }
}
// catch (e: any) in a comment, and (e as any).message too
export const msg = 'catch (e: any) { (e as any).message }';
export function c(items: Event[]) { return items.map((e) => (e as CustomEvent).detail); }
export function d(x: unknown) { return (x as Foo).bar; }
export const p = fetch('/x').catch((e: unknown) => logger.error(String(e)));
declare class Foo { bar: string }
export const t = (event as any).target;
