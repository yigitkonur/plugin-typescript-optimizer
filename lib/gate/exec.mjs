// Gate leg execution (doc 05 §5, §9; references/gate-spec.md §2, §4, §5).
// runLeg(leg, opts) runs one run.json `gate.legs[]` entry and returns a uniform result; it never throws.
// Probed, not versioned: a typecheck/declaration-emit command that fails with a "this option combination is not allowed"
// diagnostic (TS5094, TS5053, TS5065, TS6310, TS6305…) is retried in the emit-and-clean form and the variant is reported in `adopted`.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';
import { readRun, runDir, writeRun } from '../artifacts/store.mjs';
import { run as runProc } from '../core/proc.mjs';
import { statusPaths } from '../core/git.mjs';
import { toPosix } from '../core/fs.mjs';
import { parseConfigDiagnostics, parseDiagnostics } from './diagnostics.mjs';

export const TAIL_BYTES = 4096;
const TAIL_FILE_BYTES = 64 * 1024;
const PRESERVE_LIMIT = 512 * 1024 * 1024;
/** option-combination diagnostics that select the alternative command instead of failing the leg */
export const PROBE_CODES = new Set(['TS5094', 'TS5053', 'TS5065', 'TS6310', 'TS6305', 'TS6306', 'TS6307']);

export const sha1s = (s) => createHash('sha1').update(s).digest('hex');

/** re-read run.json, apply fn(run), write: long-running gate steps must not clobber concurrent edits */
export function updateRun(root, runId, fn) {
  const run = readRun(root, runId);
  fn(run);
  writeRun(root, run);
  return run;
}

/** the config a typecheck/declaration command targets: value after -p/--project/-b/--build, else the script name or full cmd */
export function legConfigArg(cmd) {
  for (let i = 1; i < cmd.length; i++) if (['-p', '--project', '-b', '--build'].includes(cmd[i]) && cmd[i + 1] && !cmd[i + 1].startsWith('-')) return cmd[i + 1];
  return cmd.slice(1).join(' ');
}
/** stable identity of a leg across variant changes (cwd + config) */
export const legKey = (leg) => `${leg.id}@${leg.cwd || '.'}:${legConfigArg(leg.cmd || [])}`;

/** copy of a typecheck leg that runs another compiler binary (the fast loop) */
export function swapBin(leg, bin) {
  const out = { ...leg, cmd: [bin, ...leg.cmd.slice(1)] };
  if (leg.clean_cmd) out.clean_cmd = [bin, ...leg.clean_cmd.slice(1)];
  return out;
}

function resolveCmd(root, cmd) {
  const [a, ...rest] = cmd;
  if (isAbsolute(a) || !a.includes('/')) return [a, ...rest];
  return [join(root, a), ...rest];
}

const combined = (r) => (r.stdout || '') + (r.stderr ? (r.stdout && !r.stdout.endsWith('\n') ? '\n' : '') + r.stderr : '');

async function exec(argv, cwd, timeoutMs, env) {
  const r = await runProc(argv, { cwd, timeoutMs, env, maxBytes: 64 * 1024 * 1024 });
  return { code: r.code, out: combined(r), ms: r.ms, timedOut: r.timedOut, error: r.error, signal: r.signal };
}

const codesOf = (diags) => new Set(diags.map((d) => d.code));
export function parseAllDiagnostics(out) { return [...parseDiagnostics(out), ...parseConfigDiagnostics(out)]; }
const isProbe = (diags) => diags.some((d) => PROBE_CODES.has(d.code));

/** diagnostics for fingerprinting; a failing command whose output has none gets one synthetic entry so "failed" is never silently "no errors" */
export function effectiveDiagnostics(res) {
  const d = res.diagnostics || [];
  if (res.status === 'fail' && !d.some((x) => !x.severity || x.severity === 'error')) {
    return [{ file: '', line: 0, col: 0, severity: 'error', code: 'TS0', message: res.timed_out ? 'command timed out' : `command failed (exit ${res.exit}) without parseable diagnostics` }];
  }
  return d;
}

/** effectiveDiagnostics with file paths made repo-relative (tsc prints them relative to the leg's cwd) */
export function legDiagnostics(leg, res) {
  const cwd = leg.cwd || '.';
  return effectiveDiagnostics(res).map((d) => (d.file && cwd !== '.' ? { ...d, file: posix.join(toPosix(cwd), d.file) } : d));
}

const slug = (s) => (s === '.' || !s ? 'root' : s.replace(/[^A-Za-z0-9]+/g, '_'));

function saveTail(leg, out, { root, outDir, wave, attempt }) {
  if (!outDir) return undefined;
  try {
    mkdirSync(outDir, { recursive: true });
    const h = sha1s((leg.cmd || []).join(' ') + (leg.cwd || '')).slice(0, 6);
    const f = join(outDir, `${wave ?? 'x'}-${leg.id}-${slug(leg.cwd)}-${h}${attempt > 1 ? '.retry' : ''}.log`);
    writeFileSync(f, out.slice(-TAIL_FILE_BYTES));
    return toPosix(relative(root, f));
  } catch { return undefined; }
}

export async function snap(root) {
  const s = await statusPaths(root);
  return s === null ? null : s.map((e) => `${e.status} ${e.path}`).sort();
}
export const delta = (a, b) => (a === null || b === null ? [] : [...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))]);

/** `tsc -b … --emitDeclarationOnly` then `tsc -b … --clean`; user outputs that existed before are preserved and restored */
async function emitAndClean({ build, clean, cwd, root, timeoutMs, env }) {
  const notes = [];
  const before = await snap(root);
  const dry = await exec([...clean, '--dry'], cwd, timeoutMs, env);
  const existing = [];
  for (const line of dry.out.split('\n')) {
    const m = /^\s*\*\s+(.+?)\s*$/.exec(line);
    if (m && existsSync(m[1])) existing.push(m[1]);
  }
  let backup = null;
  if (existing.length) {
    let total = 0;
    for (const f of existing) { try { total += statSync(f).size; } catch { /* vanished */ } }
    if (total > PRESERVE_LIMIT) return { unavailable: `pre-existing build outputs (${Math.round(total / 1048576)} MB) are too large to preserve; run \`tsc -b --clean\` yourself first` };
    backup = mkdtempSync(join(tmpdir(), 'tsopt-keep-'));
    existing.forEach((f, i) => copyFileSync(f, join(backup, String(i))));
    await exec(clean, cwd, timeoutMs, env); // build from scratch: a stale .tsbuildinfo would make `-b` skip the check
    notes.push(`preserved ${existing.length} pre-existing build output file(s)`);
  }
  let b; let c;
  try {
    b = await exec(build, cwd, timeoutMs, env);
  } finally {
    c = await exec(clean, cwd, timeoutMs, env);
    if (backup) {
      existing.forEach((f, i) => { try { mkdirSync(dirname(f), { recursive: true }); copyFileSync(join(backup, String(i)), f); } catch { /* best effort */ } });
      rmSync(backup, { recursive: true, force: true });
    }
  }
  const changed = delta(before, await snap(root));
  return { build: b, clean: c, changed, notes };
}

/** [bin, -b, cfg…, --noEmit, …] -> build and clean commands of the emit-and-clean form */
export function emitAndCleanCmds(cmd) {
  const [bin, ...rest] = cmd;
  const configs = [];
  let i = rest.findIndex((a) => a === '-b' || a === '--build');
  if (i >= 0) { for (let j = i + 1; j < rest.length && !rest[j].startsWith('-'); j++) configs.push(rest[j]); }
  else { i = rest.findIndex((a) => a === '-p' || a === '--project'); if (i >= 0 && rest[i + 1]) configs.push(rest[i + 1]); }
  const flags = rest.filter((a, k) => a === '--pretty' || rest[k - 1] === '--pretty');
  return { build: [bin, '-b', ...configs, '--emitDeclarationOnly', ...(flags.length ? flags : ['--pretty', 'false'])], clean: [bin, '-b', ...configs, '--clean'] };
}

const emitTmpCmd = (cmd) => {
  const bin = cmd[0]; const cfg = legConfigArg(cmd);
  return [bin, '-p', cfg, '--declaration', '--emitDeclarationOnly', '--outDir', '<tmp>', '--tsBuildInfoFile', '<tmp>/x.tsbuildinfo', '--pretty', 'false'];
};

/**
 * runLeg(leg, {root, wave, tmpRoot, timeoutMs, outDir, attempt, probe})
 * -> {id, cwd, status:'pass'|'fail'|'not-applicable'|'unavailable', ms, exit, variant, tail, tail_file?, diagnostics?, timed_out?, reason?, adopted?, tree_changed?, notes?}
 */
/** conventional build-output directories: if a build leg creates one that did not exist, the leg removes it again (a stale `dist/` is collected by the next test run) */
const OUTPUT_DIRS = ['dist', 'build', 'out'];

export async function runLeg(leg, opts = {}) {
  if (leg.id !== 'build') return runLegInner(leg, opts);
  const cwd = join(opts.root, leg.cwd || '.');
  const before = new Set(OUTPUT_DIRS.filter((d) => existsSync(join(cwd, d))));
  try { return await runLegInner(leg, opts); }
  finally { for (const d of OUTPUT_DIRS) if (!before.has(d) && existsSync(join(cwd, d))) { try { rmSync(join(cwd, d), { recursive: true, force: true }); } catch { /* best effort */ } } }
}

async function runLegInner(leg, opts = {}) {
  const { root, wave = null, tmpRoot = null, timeoutMs = null, outDir = null, attempt = 1, probe = true } = opts;
  const t0 = Date.now();
  const cwd = join(root, leg.cwd || '.');
  const tmo = timeoutMs ?? (leg.timeout_s ? leg.timeout_s * 1000 : 600_000);
  const env = leg.ci_env || {};
  const res = { id: leg.id, cwd: leg.cwd || '.', status: 'fail', ms: 0, exit: null, variant: leg.variant ?? null, tail: '' };
  const done = (out, extra = {}) => {
    Object.assign(res, extra);
    res.ms = Date.now() - t0;
    res.tail = out.slice(-TAIL_BYTES);
    const f = saveTail(leg, out, { root, outDir, wave, attempt });
    if (f) res.tail_file = f;
    if (leg.id === 'typecheck' || leg.id === 'declaration-emit' || leg.id === 'build-refs') res.diagnostics = parseAllDiagnostics(out);
    return res;
  };
  const unavailable = (reason) => ({ ...res, status: 'unavailable', reason, ms: Date.now() - t0, tail: '' });
  if (!Array.isArray(leg.cmd) || !leg.cmd.length) return unavailable('leg has no command');
  const cmd = resolveCmd(root, leg.cmd);
  if ((isAbsolute(cmd[0]) || cmd[0].includes('/')) && !existsSync(cmd[0])) return unavailable(`binary not found: ${leg.cmd[0]}`);

  const wantsTmp = leg.cmd.some((a) => a.includes('<tmp>'));
  const emitVariant = leg.variant === 'emit-and-clean';
  const treeLeg = wantsTmp || emitVariant;
  const before = treeLeg ? await snap(root) : null;

  try {
    // --- emit-and-clean (already chosen, or adopted below) -------------------------------------------------------------
    const runEmitAndClean = async (buildCmd, cleanCmd, adoptedFrom = null) => {
      const e = await emitAndClean({ build: resolveCmd(root, buildCmd), clean: resolveCmd(root, cleanCmd), cwd, root, timeoutMs: tmo, env });
      if (e.unavailable) return { out: '', extra: { status: 'unavailable', reason: e.unavailable } };
      const out = e.build.out;
      const ok = e.build.code === 0 && !e.build.timedOut;
      const extra = { exit: e.build.code, status: ok && !e.changed.length ? 'pass' : 'fail', variant: 'emit-and-clean', timed_out: e.build.timedOut || undefined, notes: e.notes };
      if (e.build.error) extra.reason = e.build.error;
      let tail = out;
      if (e.changed.length) { extra.tree_changed = e.changed; tail += `\nts-optimize: git status changed during the ${leg.id} leg: ${e.changed.slice(0, 10).join(', ')}\n`; }
      if (e.clean.code !== 0) tail += `\nts-optimize: cleanup (${cleanCmd.slice(1).join(' ')}) exited ${e.clean.code}\n`;
      if (adoptedFrom) extra.adopted = { variant: 'emit-and-clean', cmd: buildCmd, clean_cmd: cleanCmd, from: adoptedFrom };
      return { out: tail, extra };
    };

    if (emitVariant) {
      const clean = leg.clean_cmd || emitAndCleanCmds(leg.cmd).clean;
      const r = await runEmitAndClean(leg.cmd, clean);
      return done(r.out, r.extra);
    }

    // --- plain / temp-outdir commands -----------------------------------------------------------------------------------
    let tmp = null;
    let argv = cmd;
    if (wantsTmp) {
      tmp = mkdtempSync(join(tmpRoot || tmpdir(), 'tsopt-emit-'));
      argv = cmd.map((a) => a.split('<tmp>').join(tmp));
    }
    let r;
    try { r = await exec(argv, cwd, tmo, env); } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
    if (r.error && r.code === null && !r.timedOut) return unavailable(`cannot run ${leg.cmd[0]}: ${r.error}`);
    let out = r.out;
    let extra = { exit: r.code, status: r.code === 0 && !r.timedOut ? 'pass' : 'fail', timed_out: r.timedOut || undefined };

    if (extra.status === 'fail' && probe && ['typecheck', 'declaration-emit'].includes(leg.id)) {
      const diags = parseAllDiagnostics(out);
      if (isProbe(diags)) {
        const codes = [...codesOf(diags)].filter((c) => PROBE_CODES.has(c));
        const bMode = leg.cmd.includes('-b') || leg.cmd.includes('--build');
        if (leg.id === 'typecheck' && !bMode && codes.includes('TS5053') && !codes.some((c) => c !== 'TS5053')) {
          // `-p … --noEmit` with emitDeclarationOnly: check through a disposable declaration emit instead
          const alt = emitTmpCmd(leg.cmd);
          const t2 = mkdtempSync(join(tmpRoot || tmpdir(), 'tsopt-emit-'));
          let r2; try { r2 = await exec(resolveCmd(root, alt).map((a) => a.split('<tmp>').join(t2)), cwd, tmo, env); } finally { rmSync(t2, { recursive: true, force: true }); }
          if (!isProbe(parseAllDiagnostics(r2.out))) {
            out = r2.out;
            extra = { exit: r2.code, status: r2.code === 0 && !r2.timedOut ? 'pass' : 'fail', timed_out: r2.timedOut || undefined, variant: 'emit-tmp', adopted: { variant: 'emit-tmp', cmd: alt, from: codes } };
          }
        } else {
          const cmds = emitAndCleanCmds(leg.cmd);
          const e = await runEmitAndClean(cmds.build, cmds.clean, codes);
          // adopt only when the alternative form no longer trips the probe codes (a genuine config error stays a genuine failure)
          if (e.extra.status !== 'unavailable' && !isProbe(parseAllDiagnostics(e.out))) { out = e.out; extra = e.extra; }
        }
      }
    }
    if (treeLeg) {
      const changed = delta(before, await snap(root));
      if (changed.length) { extra.status = 'fail'; extra.tree_changed = changed; out += `\nts-optimize: git status changed during the ${leg.id} leg: ${changed.slice(0, 10).join(', ')}\n`; }
    }
    return done(out, extra);
  } catch (e) {
    return done(`ts-optimize: leg crashed: ${e && e.message}`, { status: 'fail', reason: String(e && e.message) });
  }
}

/** test/build legs: one retry on failure (not on timeout). Pass-on-retry => passed with flaky:true; two failures => failed */
export async function runWithRetry(leg, opts = {}) {
  const r = await runLeg(leg, opts);
  if (r.status !== 'fail' || r.timed_out || !['test', 'build'].includes(leg.id)) return r;
  const r2 = await runLeg(leg, { ...opts, attempt: 2 });
  r2.ms += r.ms;
  r2.attempts = 2;
  if (r2.status === 'pass') r2.flaky = true; else r2.first_failure_tail = r.tail;
  return r2;
}

/** number of tests the runner reported, or null when the output is not understood (doc 05 §9 "tests collected = 0") */
export function parseCollected(runner, out) {
  const s = String(out || '');
  let m;
  if (/No test files found|no tests found|No tests found/i.test(s)) return 0;
  if ((m = /^\s*Tests\s+(.+?)\((\d+)\)\s*$/m.exec(s))) return Number(m[2]); // vitest
  if ((m = /^\s*Tests:\s+.*?(\d+) total/m.exec(s))) return Number(m[1]); // jest
  if ((m = /^# tests (\d+)/m.exec(s))) return Number(m[1]); // node --test
  if ((m = /^\s*(\d+) passing/m.exec(s))) return Number(m[1]) + Number((/^\s*(\d+) failing/m.exec(s) || [0, 0])[1]); // mocha
  if ((m = /Ran (\d+) tests? across/.exec(s))) return Number(m[1]); // bun
  return null;
}

export { runDir };
