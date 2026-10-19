// Shared hook plumbing: read stdin JSON, find the repo root with an open run, emit one JSON object. Fails open.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export async function readInput() {
  let s = '';
  for await (const c of process.stdin) s += c;
  try { return JSON.parse(s); } catch { return {}; }
}

/** walk up from cwd to the first dir with .ts-optimize/state/open-run; stop at a .git boundary */
export function findOpenRun(cwd) {
  let d = resolve(cwd || process.cwd());
  for (;;) {
    const f = join(d, '.ts-optimize', 'state', 'open-run');
    if (existsSync(f)) {
      const id = readFileSync(f, 'utf8').trim();
      return id ? { root: d, id } : null;
    }
    if (existsSync(join(d, '.git'))) return null;
    const n = dirname(d);
    if (n === d) return null;
    d = n;
  }
}

export function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

export function runHook(fn) {
  fn().catch(() => {}).finally(() => process.exit(0)); // infrastructure errors never block or speak
}

/** ring buffer (<= 200 lines) of hook decisions in .ts-optimize/state/hook-log.jsonl; no snippets, only metadata. Never throws. */
export function logHook(cwd, entry) {
  try {
    let d = resolve(cwd || process.cwd());
    for (;;) {
      if (existsSync(join(d, '.ts-optimize'))) break;
      if (existsSync(join(d, '.git'))) return;
      const n = dirname(d); if (n === d) return; d = n;
    }
    const f = join(d, '.ts-optimize', 'state', 'hook-log.jsonl');
    mkdirSync(dirname(f), { recursive: true });
    let lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify({ t: new Date().toISOString(), ...entry }));
    if (lines.length > 200) lines = lines.slice(-200);
    writeFileSync(f, lines.join('\n') + '\n');
  } catch { /* logging must never affect the hook */ }
}
