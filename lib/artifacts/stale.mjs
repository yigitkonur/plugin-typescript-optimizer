// Stale findings: a pending finding whose files changed since the audit no longer describes the code (doc 04 §3.5).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFindings, updateFinding } from '../gate/findings.mjs';
import { readRun, runDir, stampLog } from './store.mjs';
import { run as runProc } from '../core/proc.mjs';
import { writeAtomic, readJsonc, isFile } from '../core/fs.mjs';

const PENDING = new Set(['open', 'approved']);

/** -> {stale:[{id, files}], checked} ; marks findings stale on disk, removes them from plan.md, the lock and index.json */
export async function staleCheck(root, runId, { apply = true } = {}) {
  const run = readRun(root, runId);
  const since = run.repo?.head;
  if (!since) return { stale: [], checked: 0, note: 'no audit head recorded' };
  const changed = new Set();
  const base = run.applying?.base;
  const lines = async (args) => { const r = await runProc(['git', ...args], { cwd: root, timeoutMs: 20_000, maxBytes: 16 * 1024 * 1024 }); return r.code === 0 ? r.stdout : null; };
  const add = (out) => { for (const f of (out || '').split('\0').filter(Boolean)) if (!f.startsWith('.ts-optimize/')) changed.add(f); };
  if (!base) add(await lines(['diff', '--name-only', '-z', since, 'HEAD']));
  else {
    // after `run begin` the run's own commits (Run:/Reverts-Finding: trailers) are expected changes (rescan handles their effect on evidence); anyone else's are not
    const log = await lines(['log', '-z', '--format=%H%n%B', `${base}..HEAD`]);
    for (const c of (log || '').split('\0').filter(Boolean)) {
      const [sha, ...body] = c.split('\n');
      const text = body.join('\n');
      if (new RegExp(`^Run: ${runId.replace(/[^\w-]/g, '\\$&')}$`, 'm').test(text) || /^Reverts-Finding: F-\d+$/m.test(text)) continue;
      add(await lines(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha.trim()]));
    }
  }
  add(await lines(['diff', '--name-only', '-z', 'HEAD']));
  add(await lines(['ls-files', '-z', '--others', '--exclude-standard']));
  const stale = []; let checked = 0;
  for (const f of listFindings(root, runId)) {
    if (!PENDING.has(f.front.state)) continue;
    checked++;
    const hit = (f.front.touches || []).filter((t) => changed.has(t));
    if (hit.length) stale.push({ id: f.id, files: hit });
  }
  if (apply && stale.length) {
    const ids = new Set(stale.map((s) => s.id));
    for (const s of stale) updateFinding(root, runId, s.id, (fm) => { fm.state = 'stale'; fm.wave = fm.wave; });
    const rd = runDir(root, runId);
    const planFile = join(rd, 'plan.md');
    if (isFile(planFile)) writeAtomic(planFile, readFileSync(planFile, 'utf8').split('\n').filter((l) => ![...ids].some((id) => new RegExp(`^- \\[[ xX]\\] ${id}\\b`).test(l))).join('\n'));
    const lockFile = join(rd, 'plan.lock.json');
    if (isFile(lockFile)) { const lk = readJsonc(lockFile).value; lk.approved = (lk.approved || []).filter((id) => !ids.has(id)); writeAtomic(lockFile, JSON.stringify(lk, null, 2) + '\n'); }
    const idxFile = join(rd, 'findings', 'index.json');
    if (isFile(idxFile)) { const idx = readJsonc(idxFile).value; for (const row of idx.findings) if (ids.has(row.id)) row.state = 'stale'; idx.counts.by_state = {}; for (const row of idx.findings) idx.counts.by_state[row.state] = (idx.counts.by_state[row.state] || 0) + 1; writeAtomic(idxFile, JSON.stringify(idx, null, 2) + '\n'); }
    stampLog(root, runId, { ev: 'rescan', wave: null, new_cascades: [], stale: [...ids] });
  }
  return { stale, checked };
}
