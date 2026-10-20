// Finding-file helpers for the fix phase (read, list, update front matter without touching the body).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFinding, writeFinding } from '../artifacts/finding.mjs';
import { runDir } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { readJsonc, writeAtomic } from '../core/fs.mjs';

export const findingPath = (root, runId, fid) => join(runDir(root, runId), 'findings', `${fid}.md`);

export function listFindings(root, runId) {
  const dir = join(runDir(root, runId), 'findings');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^F-\d{4}\.md$/.test(f)).sort().map((f) => {
    const r = readFinding(join(dir, f));
    return { id: r.front.id, front: r.front, sections: r.sections, body: r.body, path: join(dir, f) };
  });
}

export function getFinding(root, runId, fid) {
  const p = findingPath(root, runId, fid);
  if (!existsSync(p)) throw new TsOptError(EXIT.NOTHING, `no finding ${fid} in run ${runId}`);
  const r = readFinding(p);
  return { id: fid, front: r.front, sections: r.sections, body: r.body, path: p };
}

/** mutate(front) -> front (or void to mutate in place); the body is rewritten with `appliedText` replacing the "## Applied" section when given */
export function updateFinding(root, runId, fid, mutate, appliedText = null) {
  const f = getFinding(root, runId, fid);
  const front = structuredClone(f.front);
  const out = mutate(front) || front;
  let body = f.body;
  if (appliedText !== null) body = body.replace(/## Applied[\s\S]*$/, `## Applied\n\n${appliedText}\n`);
  writeFinding(f.path, out, body);
  return out;
}

/** index.json rows with state/wave taken from the finding files (the files are the source of truth once a run is applying) */
export function liveIndexRows(root, runId, rows) {
  const live = new Map(listFindings(root, runId).map((f) => [f.id, f.front]));
  return rows.map((r) => { const f = live.get(r.id); return f ? { ...r, state: f.state, wave: f.wave, fix_mode: f.fix_mode } : r; });
}

/** rewrite index.json from the finding files (called when a wave ends and at run finish) */
export function refreshIndex(root, runId) {
  const file = join(runDir(root, runId), 'findings', 'index.json');
  const cur = readJsonc(file);
  if (!cur.ok || !cur.value) return;
  const idx = cur.value;
  idx.findings = liveIndexRows(root, runId, idx.findings);
  idx.counts.by_state = {};
  for (const r of idx.findings) idx.counts.by_state[r.state] = (idx.counts.by_state[r.state] || 0) + 1;
  writeAtomic(file, JSON.stringify(idx, null, 2) + '\n');
}
