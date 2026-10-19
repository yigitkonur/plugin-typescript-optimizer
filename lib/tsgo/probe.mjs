// Timed pass (doc 05 §8.3 steps 2-3): run the authoritative and the native compiler on the same configuration, time both,
// compare diagnostics. Read-only: only --noEmit runs, and the declaration probe writes to a temporary directory.
// Every process has a timeout; nothing here throws.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../core/proc.mjs';
import { classifyAll, compareMultisets, multiset, parseTsc, repoFile } from './diag.mjs';

export const DECL_CODES = new Set(['TS4023', 'TS4058', 'TS4060', 'TS4081', 'TS4082', 'TS2742', 'TS2883']);
const MIN_FAST_TIMEOUT_MS = 15_000;
const REPEAT_BELOW_MS = 20_000;
// configuration errors after which tsc 7 stops without type-checking (observed on 7.0.2)
const SCRATCH_TRIGGER = new Set(['TS5101', 'TS5102', 'TS5107', 'TS5108', 'TS5023', 'TS6046']);
const TSCONFIG_FILE = /(^|\/)(tsconfig[^/]*|jsconfig)\.json$/;

/** { argv:[prefix…] , label } for a compiler descriptor {bin, exec}; null when it cannot be run */
export const compilerArgv = (c) => (c && c.bin ? [c.bin] : c && c.exec ? [...c.exec] : null);

const crashed = (r) => !!r.error || r.timedOut || (r.code !== 0 && r.code !== 1 && r.code !== 2) || /^panic:|goroutine \d+ \[|fatal error:/m.test(r.stderr || '');

/** one compiler run -> { argv, exit, ms, timedOut, error, diags[], crashed, tail } */
async function runOne(argv, cwd, timeoutMs, relCwd, env) {
  const r = await run(argv, { cwd, timeoutMs, env, maxBytes: 64 * 1024 * 1024 });
  const diags = parseTsc(`${r.stdout}\n${r.stderr}`).map((d) => ({ ...d, file: repoFile(d.file, relCwd) }));
  return { exit: r.code, ms: r.ms, timedOut: r.timedOut, error: r.error || null, diags, crashed: crashed(r), tail: `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-3).join('\n').slice(0, 400), raw_has_5094: /TS5094/.test(r.stdout + r.stderr) };
}

const argvFor = (entry, prefix, extra) => {
  const cfg = entry.config || 'tsconfig.json';
  if (entry.variant === 'tsc-b') return [...prefix, '-b', cfg, '--noEmit', '--pretty', 'false', ...extra];
  return [...prefix, '-p', cfg, '--noEmit', '--pretty', 'false', ...extra];
};

/**
 * run every typecheck-set entry with one compiler. -> {ms, runs_ms[], exit, entries[], diags[], crashed, timedOut, skipped[]}
 * Wall time is the best of two full passes when the first pass took under REPEAT_BELOW_MS (the first pass pays the cold file cache);
 * diagnostics come from the first pass. `ms` is the best, `runs_ms` lists every pass.
 */
async function runSet(set, prefix, cwd, relCwd, timeoutMs, extra = []) {
  const res = { ms: 0, runs_ms: [], exit: 0, entries: [], diags: [], crashed: false, timedOut: false, skipped: [], tail: '' };
  for (const entry of set) {
    if (entry.variant === 'script' || entry.variant === 'deno') { res.skipped.push({ config: entry.config || entry.script || null, reason: `script-defined typecheck (${entry.checker || entry.variant}) is not comparable` }); continue; }
    const r = await runOne(argvFor(entry, prefix, extra), cwd, timeoutMs, relCwd);
    if (entry.variant === 'tsc-b' && r.raw_has_5094) { res.skipped.push({ config: entry.config, reason: 'tsc -b --noEmit is not supported by this compiler (TS5094); fit is read-only and does not run emit-and-clean' }); continue; }
    res.ms += r.ms; res.diags.push(...r.diags);
    res.exit = Math.max(res.exit, r.exit ?? 0);
    res.crashed ||= r.crashed; res.timedOut ||= r.timedOut; res.tail = r.tail;
    res.entries.push({ config: entry.config, variant: entry.variant, ms: r.ms, exit: r.exit, diagnostics: r.diags.length, argv: entry.variant === 'tsc-b' ? '-b' : '-p' });
    if (r.timedOut) break;
  }
  res.runs_ms = [res.ms];
  if (res.entries.length && !res.crashed && !res.timedOut && res.ms < REPEAT_BELOW_MS) {
    let again = 0;
    for (const entry of set) {
      if (!res.entries.some((e) => e.config === entry.config)) continue;
      const r = await runOne(argvFor(entry, prefix, extra), cwd, timeoutMs, relCwd);
      again += r.ms;
      if (r.timedOut || r.crashed) { again = Infinity; break; }
    }
    if (Number.isFinite(again)) { res.runs_ms.push(again); res.ms = Math.min(res.ms, again); }
  }
  return res;
}

/**
 * timedPass({pkgDir, relPath, set, auth, fast, capMs, prefixes, defaults})
 *  auth/fast: { argv: [..prefix], native: bool }
 * -> { ran, ms:{auth,fast,fast_single}, auth:{…}, fast:{…}, fast_single:{…}|null, diag_equal, only_authoritative, only_native, divergence, skipped[], notes[] }
 * When auth.native the compiler runs once; fast mirrors it and parity is n/a (diag_equal null).
 */
export async function timedPass({ pkgDir, relPath, set, auth, fast, capMs, prefixes = [], defaults = [], scratchFor = null }) {
  const relCwd = relPath === '.' ? '' : relPath;
  const notes = [];
  const a = await runSet(set, auth.argv, pkgDir, relCwd, capMs);
  const out = { ran: a.entries.length > 0, ms: { auth: a.entries.length ? a.ms : null, fast: null, fast_single: null }, auth: a, fast: null, fast_single: null, diag_equal: null, only_authoritative: [], only_native: [], divergence: { by_category: {}, unexplained: 0 }, skipped: a.skipped, notes };
  if (!a.entries.length) { notes.push('no typecheck-set entry could be run with the authoritative compiler'); return out; }
  if (a.timedOut) notes.push(`authoritative compiler hit the ${Math.round(capMs / 1000)} s cap`);
  const cleanups = [];
  try {
  if (auth.native) {
    out.ms.fast = out.ms.auth; out.fast = a;
    notes.push('authoritative compiler is native: parity is n/a, the timing is shared');
  } else if (fast) {
    const fastCap = Math.min(capMs, Math.max(5 * a.ms, MIN_FAST_TIMEOUT_MS));
    const f = await runSet(set, fast.argv, pkgDir, relCwd, fastCap);
    out.fast = f;
    if (f.entries.length) out.ms.fast = f.ms;
    let nativeDiags = f.diags;
    if (scratchFor && f.entries.length && !f.crashed && f.diags.some((d) => SCRATCH_TRIGGER.has(d.code) && TSCONFIG_FILE.test(d.file))) {
      const made = set.map((e) => (e.variant === 'tsc' ? scratchFor(e) : null));
      for (const m of made) if (m) cleanups.push(m.cleanup);
      if (made.some(Boolean)) {
        {
          const sset = set.map((e, i) => (made[i] ? { ...e, config: made[i].config } : e));
          const sres = await runSet(sset, fast.argv, pkgDir, relCwd, fastCap);
          if (sres.entries.length && !sres.crashed) {
            out.scratch = { used: true, ms: sres.ms, unmodified_ms: f.ms, overrides: made.filter(Boolean).map((m) => m.overrides), entries: sres.entries };
            out.ms.fast_unmodified = f.ms; out.ms.fast = sres.ms;
            nativeDiags = [...f.diags.filter((d) => d.file === '' || TSCONFIG_FILE.test(d.file)), ...sres.diags];
            out.scratchSet = sset; out.fast = { ...sres, diags: nativeDiags };
            notes.push('the native compiler stopped at configuration errors without type-checking; its timing and the non-configuration diagnostics come from a temporary tsconfig that unsets the removed options (project files untouched)');
          }
        }
      }
    }
    if (f.timedOut) notes.push(`native compiler hit its ${Math.round(fastCap / 1000)} s cap (5x the authoritative time, floor ${MIN_FAST_TIMEOUT_MS / 1000} s)`);
    if (f.crashed) notes.push(`native compiler did not complete cleanly: ${f.tail.split('\n').pop()}`);
    if (f.entries.length && !f.crashed && !a.timedOut) {
      const cmp = compareMultisets(multiset(a.diags, prefixes), multiset(nativeDiags, prefixes));
      const cl = classifyAll(cmp, defaults);
      out.diag_equal = cmp.equal;
      out.only_authoritative = cl.only_authoritative; out.only_native = cl.only_native; out.divergence = cl.summary;
    }
  }
  const nativeSide = auth.native ? auth : fast;
  if (nativeSide && a.entries.length && !a.timedOut) {
    const s = await runSet(out.scratchSet && !auth.native ? out.scratchSet : set, nativeSide.argv, pkgDir, relCwd, Math.min(capMs, Math.max(5 * (out.ms.fast ?? a.ms), MIN_FAST_TIMEOUT_MS)), ['--singleThreaded']);
    out.fast_single = s;
    if (s.entries.length && !s.crashed && !s.diags.some((d) => (d.code === 'TS5023' || d.code === 'TS5025') && /singleThreaded/i.test(d.message))) out.ms.fast_single = s.ms;
    else notes.push('the native compiler did not accept --singleThreaded (experimental flag); single-threaded timing unavailable');
  }
  return out;
  } finally { for (const c of cleanups) { try { c(); } catch { /* temp file already gone */ } } }
}

/** compare diagnostics only on the declaration-emit path (tc-10). Never reads or compares .d.ts bytes. */
export async function declarationProbe({ pkgDir, relPath, config, auth, fast, capMs, prefixes = [] }) {
  const relCwd = relPath === '.' ? '' : relPath;
  const tmp = mkdtempSync(join(tmpdir(), 'tsopt-fit-decl-'));
  const mk = (prefix) => [...prefix, '-p', config, '--declaration', '--emitDeclarationOnly', '--noEmit', 'false', '--outDir', join(tmp, 'out'), '--tsBuildInfoFile', join(tmp, 'x.tsbuildinfo'), '--pretty', 'false'];
  try {
    const a = await runOne(mk(auth.argv), pkgDir, capMs, relCwd);
    const unsupported = (r) => r.diags.some((d) => ['TS5053', 'TS5055', 'TS5065', 'TS5069'].includes(d.code));
    if (unsupported(a) || a.crashed) return { checked: false, reason: a.crashed ? 'authoritative declaration run did not complete' : 'declaration-only emit is not supported with this configuration (TS5053/5065)' };
    const f = await runOne(mk(fast.argv), pkgDir, Math.min(capMs, Math.max(5 * a.ms, MIN_FAST_TIMEOUT_MS)), relCwd);
    if (unsupported(f) || f.crashed) return { checked: false, reason: f.crashed ? 'native declaration run did not complete' : 'declaration-only emit is not supported by the native compiler with this configuration' };
    const watch = (r) => r.diags.filter((d) => DECL_CODES.has(d.code));
    const cmp = compareMultisets(multiset(watch(a), prefixes), multiset(watch(f), prefixes));
    return { checked: true, ms: { auth: a.ms, fast: f.ms }, watched_codes: [...DECL_CODES], only_authoritative: cmp.only_a, only_native: cmp.only_b, equal: cmp.equal };
  } catch (e) {
    return { checked: false, reason: `declaration probe failed: ${e.message}` };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** version probe for a candidate native compiler: `<bin> --version` within 5 s -> {version, major} | null */
export async function probeVersion(prefix) {
  const r = await run([...prefix, '--version'], { timeoutMs: 5000 });
  const m = /Version\s+(\d+\.\d+\.\d+\S*)/.exec(r.stdout || '');
  return r.code === 0 && m ? { version: m[1], major: Number(m[1].split('.')[0]) } : null;
}
