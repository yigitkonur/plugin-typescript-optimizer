declare function run(): void; declare const logger: { error(m: string): void };
export function a() {
  try { run(); } catch (e: any) { logger.error(e.message); }
}
export function b() {
  try { run(); } catch (err) { logger.error((err as any).message); }
}
export const c = fetch('/x').catch((e: any) => logger.error(e.message));
export function d() {
  try { run(); } catch (error) { return (error as any).code; }
}
