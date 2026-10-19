import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tryParseJsonc } from './jsonc.mjs';

export const toPosix = (p) => (sep === '\\' ? p.split('\\').join('/') : p);
export const exists = (p) => existsSync(p);
export function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }
export function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
export function mtimeKey(p) { try { const s = statSync(p); return `${p}:${s.mtimeMs}:${s.size}`; } catch { return `${p}:-`; } }
export function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }
export function readJsonc(p) {
  const t = readText(p);
  if (t === null) return { ok: false, error: 'unreadable', value: null };
  const r = tryParseJsonc(t);
  return r.ok ? r : { ok: false, error: r.error, value: null };
}
export function readJsonOr(p, dflt = null) { const r = readJsonc(p); return r.ok ? r.value : dflt; }
export function mkdirp(p) { mkdirSync(p, { recursive: true }); }
// write via temp file + rename so readers never see a half-written artifact
export function writeAtomic(p, text) {
  mkdirp(dirname(p));
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}
export function listDir(p) { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } }
// nearest ancestor (inclusive) of `start` for which pred(dir) is truthy, stopping at `stopAt` (inclusive)
export function walkUp(start, pred, stopAt = null) {
  let d = resolve(start);
  const stop = stopAt ? resolve(stopAt) : null;
  for (;;) {
    const r = pred(d);
    if (r) return { dir: d, value: r };
    if (stop && d === stop) return null;
    const n = dirname(d);
    if (n === d) return null;
    d = n;
  }
}
export { join, resolve, dirname };
