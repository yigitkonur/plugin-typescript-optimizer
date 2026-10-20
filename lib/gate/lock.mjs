// Advisory run lock: exclusive-create `state/lock` held for the duration of a mutating command; a dead pid is taken over (doc 04 §2).
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { artDir } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { mkdirp } from '../core/fs.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export async function withRunLock(root, runId, label, fn) {
  const dir = join(artDir(root), 'state');
  mkdirp(dir);
  const file = join(dir, 'lock');
  let fd = null;
  for (let attempt = 0; attempt < 2 && fd === null; attempt++) {
    try { fd = openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null; try { held = JSON.parse(readFileSync(file, 'utf8')); } catch { /* unreadable lock is stale */ }
      if (held && held.pid && alive(held.pid) && held.pid !== process.pid) throw new TsOptError(EXIT.PRECONDITION, `${held.label || 'another command'} is running for run ${held.run} (pid ${held.pid}, started ${held.started})`, 'wait for it to finish; if it crashed, the lock is taken over automatically once its process is gone');
      rmSync(file, { force: true }); // stale: previous owner is gone
    }
  }
  if (fd === null) throw new TsOptError(EXIT.PRECONDITION, 'could not acquire the run lock');
  writeSync(fd, JSON.stringify({ pid: process.pid, session: process.env.CLAUDE_SESSION_ID || null, host: hostname(), started: nowIso(), run: runId, label }));
  closeSync(fd);
  try { return await fn(); } finally { rmSync(file, { force: true }); }
}
