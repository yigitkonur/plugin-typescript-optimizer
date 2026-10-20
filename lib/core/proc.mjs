// Process spawning: argument arrays only, timeouts, process-group kill, bounded output (doc 02 §3.1, §7).
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';

export const IS_WIN = process.platform === 'win32';
const WORKER_UNSAFE = /--v8-pool-size(=\S*)?|--max-semi-space-size(=\S*)?/g;

export function sanitizeNodeOptions(s) {
  if (!s) return s;
  return s.replace(WORKER_UNSAFE, '').replace(/\s+/g, ' ').trim();
}

export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  env.CI = '1';
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  env.NPM_CONFIG_UPDATE_NOTIFIER = 'false';
  env.GIT_TERMINAL_PROMPT = '0';
  if (env.NODE_OPTIONS) {
    const clean = sanitizeNodeOptions(env.NODE_OPTIONS);
    if (clean) env.NODE_OPTIONS = clean; else delete env.NODE_OPTIONS;
  }
  return env;
}

// Windows: npm, pnpm, yarn and node_modules/.bin/* are .cmd shims, which Node (>= 18.20.2, 20.12.2) refuses to spawn without a shell.
// Resolve the shim ourselves and run it through cmd.exe with every argument quoted; an argument cmd.exe would expand or split is refused.
function resolveWin(cmd, env) {
  const exts = ['.exe', '.cmd', '.bat', '.com'];
  const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
  const tryExts = (base) => (extname(base) ? (isFile(base) ? base : null) : exts.map((e) => base + e).find(isFile) || null);
  if (isAbsolute(cmd) || /[\\/]/.test(cmd)) return tryExts(cmd) || cmd;
  const path = env.PATH || env.Path || process.env.PATH || process.env.Path || '';
  for (const d of path.split(delimiter).filter(Boolean)) { const hit = tryExts(join(d, cmd)); if (hit) return hit; }
  return cmd;
}
const cmdQuote = (a) => {
  if (/["%\r\n\0]/.test(a)) return null;
  return '"' + a.replace(/(\\+)$/, '$1$1') + '"';
};
export function spawnPlan(cmd, args, env, win = IS_WIN) {
  if (!win) return { file: cmd, args, opts: {} };
  const file = resolveWin(cmd, env);
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, opts: {} };
  const q = [file, ...args].map(cmdQuote);
  if (q.includes(null)) return { error: `argument not safe to pass through cmd.exe for ${cmd} (contains a quote, percent sign or line break)` };
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', '"' + q.join(' ') + '"'], opts: { windowsVerbatimArguments: true } };
}

function killTree(child, signal) {
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
    } else {
      process.kill(-child.pid, signal);
    }
  } catch { try { child.kill(signal); } catch { /* already gone */ } }
}

/**
 * run(argv, {cwd, timeoutMs, env, input, maxBytes, stopWhen})
 * -> {code, signal, stdout, stderr, timedOut, truncated, ms, error}
 * Never rejects; spawn failures come back in `error` with code null.
 */
export function run(argv, opts = {}) {
  const { cwd, timeoutMs = 120_000, env = {}, input = null, maxBytes = 20 * 1024 * 1024, stopWhen = null } = opts;
  const [cmd, ...args] = argv;
  const t0 = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      const cenv = childEnv(env);
      const plan = spawnPlan(cmd, args, cenv);
      if (plan.error) { resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, ms: 0, error: plan.error }); return; }
      child = spawn(plan.file, plan.args, {
        cwd, env: cenv, shell: false, windowsHide: true, ...plan.opts,
        detached: !IS_WIN, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, truncated: false, ms: 0, error: e.message });
      return;
    }
    let stdout = ''; let stderr = ''; let timedOut = false; let truncated = false; let done = false; let stoppedEarly = false;
    const finish = (code, signal, error = null) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(grace);
      // Windows tools end lines with CRLF; every parser downstream splits on \n and uses `.` (which does not match \r)
      if (IS_WIN) { stdout = stdout.replace(/\r\n/g, '\n'); stderr = stderr.replace(/\r\n/g, '\n'); }
      resolve({ code, signal, stdout, stderr, timedOut, truncated, stoppedEarly, ms: Date.now() - t0, error });
    };
    let grace = null;
    const timer = setTimeout(() => {
      timedOut = true; killTree(child, 'SIGTERM');
      grace = setTimeout(() => { killTree(child, 'SIGKILL'); finish(null, 'SIGKILL'); }, 2000);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      if (stdout.length < maxBytes) stdout += d; else truncated = true;
      if (stopWhen && !stoppedEarly && stopWhen(stdout)) { stoppedEarly = true; killTree(child, 'SIGTERM'); }
    });
    child.stderr.on('data', (d) => { if (stderr.length < maxBytes) stderr += d; else truncated = true; });
    child.on('error', (e) => finish(null, null, e.message));
    child.on('close', (code, signal) => finish(code, signal));
    if (input !== null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
