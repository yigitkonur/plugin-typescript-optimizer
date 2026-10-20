// The fast loop (doc 02 §3.2): typecheck with the fast compiler (else the authoritative one) and report errors that are NEW
// against the matching baseline multiset. The result is valid only for the worktree fingerprint it was computed at.
import { isAbsolute, join, relative } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { ART, assertSafeArtifactTree, openRunId, readRun, runDir, stampLog } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, toPosix, writeAtomic } from '../core/fs.mjs';
import { run as runProc } from '../core/proc.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { resolveLegs } from './legs.mjs';
import { readBaselineDiagnostics } from './baseline.mjs';
import { legDiagnostics, runLeg, swapBin } from './exec.mjs';
import { diagFingerprint, diagMultiset, newFingerprints, worktreeFingerprint } from './fingerprint.mjs';

const FAST_VARIANTS = new Set(['noemit', 'noemit-b', 'emit-and-clean', 'emit-tmp']);
const MAX_SHOWN = 50;

const rel = (root, p) => (p && isAbsolute(p) && p.startsWith(root) ? toPosix(relative(root, p)) : p);

/** timeout: min(20 s, 5 x the baseline fast time) when a baseline time exists (floored at 3 s so process start-up jitter cannot fail a check) */
export function checkTimeoutMs(baselineMs, legTimeoutS) {
  if (baselineMs) return Math.max(3000, Math.min(20_000, baselineMs * 5));
  return (legTimeoutS || 600) * 1000;
}

export async function runCheck({ root, runId = null, paths = null, authoritative: forceAuth = false }) {
  const t0 = Date.now();
  assertSafeArtifactTree(root);
  let run = null;
  const id = runId || openRunId(root);
  if (id) { try { run = readRun(root, id); } catch { run = null; } }
  const d = await detectProject(root);
  let legs = run?.gate?.legs;
  if (!legs) legs = resolveLegs(d, loadConfig(root).config).filter((l) => l.id === 'typecheck');
  const tcLegs = legs.filter((l) => l.id === 'typecheck');
  if (!tcLegs.length) throw new TsOptError(EXIT.CAPABILITY, 'no typecheck is possible here: no typecheck leg detected', 'run `ts-opt doctor`');

  const comp = (l) => d.packages.find((p) => p.path === l.cwd)?.compilers || d.compilers;
  const primary = comp(tcLegs[0]);
  const fastOk = run?.fast_check?.enabled !== false;
  const fastBin = fastOk || forceAuth ? primary?.fast?.bin : null;
  const authBin = primary?.authoritative?.bin;
  const useFast = !forceAuth && !!fastBin && tcLegs.some((l) => FAST_VARIANTS.has(l.variant));
  const sameAsAuth = useFast && fastBin === authBin;
  const bd = id ? readBaselineDiagnostics(root, id) : null;

  // which engine, which baseline
  let engine; let baselineRec;
  if (useFast && !sameAsAuth) {
    baselineRec = bd?.fast || null;
    const v = baselineRec?.engine || (await (async () => { const r = await runProc([fastBin, '--version'], { timeoutMs: 10_000 }); const m = /Version\s+(\S+)/.exec(r.stdout); return `${primary.fast.kind}@${m ? m[1] : primary.fast.version || '?'}`; })());
    engine = { kind: primary.fast.kind, version: v.split('@')[1] || null, bin: rel(root, fastBin), source: primary.fast.source };
  } else {
    baselineRec = bd?.authoritative || null;
    const a = primary?.authoritative || {};
    engine = { kind: a.kind || 'js', version: a.version || null, bin: a.bin ? rel(root, a.bin) : null, source: a.source || null };
  }
  const runnable = tcLegs.filter((l) => (useFast ? FAST_VARIANTS.has(l.variant) : true));
  const skipped = tcLegs.filter((l) => !runnable.includes(l)).map((l) => `${l.cwd}: ${l.variant || 'script'} leg skipped (no fast form)`);

  const fingerprint = await worktreeFingerprint(root);
  const timeoutMs = checkTimeoutMs(run?.fast_check?.baseline_ms, runnable[0].timeout_s);
  const diags = [];
  const reasons = [];
  let unavailableAll = true;
  for (const l of runnable) {
    const leg = useFast && !sameAsAuth ? swapBin(l, fastBin) : l;
    const r = await runLeg(leg, { root, timeoutMs });
    if (r.status === 'unavailable') { reasons.push(r.reason); continue; }
    unavailableAll = false;
    // a timed-out check reports the timeout as an error rather than silently "no new errors"
    diags.push(...legDiagnostics(l, r).map((x) => ({ ...x })));
  }
  if (unavailableAll) throw new TsOptError(EXIT.CAPABILITY, `no typecheck is possible here: ${reasons[0] || 'compiler not runnable'}`, 'run `ts-opt doctor`');

  const cur = diagMultiset(diags, root);
  const base = baselineRec?.multiset || {};
  const fresh = newFingerprints(base, cur);
  const seen = new Map(fresh.map((f) => [f.fingerprint, f]));
  const newErrors = []; const taken = new Set();
  for (const dg of diags) {
    const fp = diagFingerprint(dg, root);
    if (seen.has(fp) && !taken.has(fp)) { taken.add(fp); newErrors.push({ file: dg.file, line: dg.line, code: dg.code, message: dg.message }); }
  }
  const ms = Date.now() - t0;
  const result = {
    engine, ms, new_errors: newErrors.slice(0, MAX_SHOWN), new_error_count: fresh.reduce((a, f) => a + (f.count - f.baseline), 0),
    baseline_errors: baselineRec ? baselineRec.count : 0, baseline: baselineRec ? 'matched' : 'none (every error counts as new)',
    fingerprint, passed: fresh.length === 0, ...(paths && paths.length ? { paths } : {}), ...(skipped.length ? { skipped } : {}),
  };
  const state = join(root, ART, 'state', 'fast-check.json');
  writeAtomic(state, JSON.stringify({ fingerprint, at: nowIso(), engine: `${engine.kind}@${engine.version || '?'}`, ms, new_errors: result.new_errors, passed: result.passed, run: id || null }, null, 2) + '\n');
  if (run && run.state === 'applying' && run.applying?.finding && isFile(join(runDir(root, run.id), 'run.json'))) {
    stampLog(root, run.id, { ev: 'check', id: run.applying.finding, result: result.passed ? 'pass' : 'fail', engine: `${engine.kind} ${engine.version || '?'}`, ms, new_errors: result.new_error_count });
  }
  return result;
}
