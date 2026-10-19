export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('t')), ms));
await new Promise((resolve) => emitter.once('ready', resolve));
await new Promise((resolve) => resolve(1));
const delayMs = 300;
const capitalized = 'x';
function capitalizeFirst(s: string) { return s; }
const sleepTimer = setTimeout(fn, 10);
export const clamp = (n: number) => n;
// await new Promise(r => setTimeout(r, 10));
const s = 'await new Promise(r => setTimeout(r, 10))';
