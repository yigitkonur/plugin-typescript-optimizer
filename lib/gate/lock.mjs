// Advisory run lock: exclusive-create `state/lock` held for the duration of a mutating command; a dead owner is taken over (doc 04 §2).
// Hardened: a lock whose owner record is not written yet is "initialising", never stale; release only removes our own lock;
// `wait` lets short, parallel callers (architect proposals) queue instead of failing.
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { artDir, assertSafeArtifactTree } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { mkdirp } from '../core/fs.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INIT_GRACE_MS = 5000;

function readOwner(file) {
  try { return { owner: JSON.parse(readFileSync(file, 'utf8')), mtime: statSync(file).mtimeMs }; }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    try { return { owner: null, mtime: statSync(file).mtimeMs }; } catch { return null; } // present but unreadable / half-written
  }
}

export async function withRunLock(root, runId, label, fn, { wait = 0 } = {}) {
  assertSafeArtifactTree(root);
  const dir = join(artDir(root), 'state');
  mkdirp(dir);
  assertSafeArtifactTree(root);
  const file = join(dir, 'lock');
  const mine = { pid: process.pid, token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`, session: process.env.CLAUDE_SESSION_ID || null, host: hostname(), started: nowIso(), run: runId, label };
  const deadline = Date.now() + wait;
  let fd = null;
  for (;;) {
    try { fd = openSync(file, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readOwner(file);
      if (held) {
        const o = held.owner;
        const initialising = !o && Date.now() - held.mtime < INIT_GRACE_MS;
        const live = o && o.pid && alive(o.pid) && o.pid !== process.pid;
        if (initialising || live) {
          if (Date.now() < deadline) { await sleep(50 + Math.random() * 100); continue; }
          throw new TsOptError(EXIT.PRECONDITION, `${o?.label || 'another command'} is running for run ${o?.run ?? runId}${o?.pid ? ` (pid ${o.pid}, started ${o.started})` : ' (starting)'}`, 'wait for it to finish; if it crashed, the lock is taken over automatically once its process is gone');
        }
        // stale: owner gone (or unreadable for longer than the grace period). Remove only the file we just inspected.
        const again = readOwner(file);
        if (again && again.mtime === held.mtime) rmSync(file, { force: true });
      }
    }
  }
  try {
    writeSync(fd, JSON.stringify(mine));
    closeSync(fd);
    return await fn();
  } finally {
    const cur = readOwner(file);
    if (cur && cur.owner && cur.owner.token === mine.token) rmSync(file, { force: true }); // never remove a lock someone else took over
  }
}
