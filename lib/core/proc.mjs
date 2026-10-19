// Process spawning: argument arrays only, timeouts, process-group kill, bounded output (doc 02 §3.1, §7).
import { spawn } from 'node:child_process';

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
      child = spawn(cmd, args, {
        cwd, env: childEnv(env), shell: false, windowsHide: true,
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
