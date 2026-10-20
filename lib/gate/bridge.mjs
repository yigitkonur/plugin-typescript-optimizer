// Wave B (lint bridge): the unused-local residue that wave 3 creates is measured at `run wave begin B` (doc 06 reach-06).
// Detection is tsc --noUnusedLocals restricted to files changed in this run; the edit is made later by the project's own lint autofix.
import { join } from 'node:path';
import { addFinding } from '../artifacts/newfinding.mjs';
import { fingerprintOf } from '../artifacts/fingerprint.mjs';
import { readRun, runDir, stampLog } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { git } from '../core/git.mjs';
import { isFile, readJsonc, writeAtomic } from '../core/fs.mjs';
import { loadConfig } from '../artifacts/config.mjs';
import { detect as runDetect } from '../detect/index.mjs';
import { legDiagnostics, runLeg } from './exec.mjs';
import { updateFinding } from './findings.mjs';
import { resolveLegs } from './legs.mjs';

export const UNUSED_CODES = new Set(['TS6133', 'TS6192', 'TS6196', 'TS6198', 'TS6199']);
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;

/** -> {files:[{file, count, codes[]}], diagnostics:[…], legs:[ids], skipped:[reasons]} */
export async function measureResidue({ root, run, detect, config }) {
  const base = run.applying?.base;
  const changed = new Set();
  if (base) for (const f of (await git(root, ['diff', '--name-only', `${base}..HEAD`])).stdout.split('\n')) if (f && SOURCE.test(f)) changed.add(f);
  const out = { files: [], diagnostics: [], legs: [], skipped: [], changed: changed.size };
  if (!changed.size) return out;
  const legs = resolveLegs(detect, config).filter((l) => l.id === 'typecheck');
  const seen = new Map();
  for (const leg of legs) {
    if (leg.variant !== 'noemit') { out.skipped.push(`${leg.cwd || '.'}: ${leg.variant} typecheck cannot take --noUnusedLocals; residue there is found by the lint engine`); continue; }
    const res = await runLeg({ ...leg, id: 'typecheck', cmd: [...leg.cmd, '--noUnusedLocals'] }, { root, wave: 'B', probe: false });
    out.legs.push(`${leg.cwd || '.'}`);
    if (res.status === 'unavailable') { out.skipped.push(`${leg.cwd || '.'}: ${res.reason}`); continue; }
    for (const d of legDiagnostics(leg, res)) {
      if (!UNUSED_CODES.has(d.code) || !changed.has(d.file)) continue;
      out.diagnostics.push(d);
      const e = seen.get(d.file) || seen.set(d.file, { file: d.file, count: 0, codes: new Set(), first: d.line }).get(d.file);
      e.count++; e.codes.add(d.code); e.first = Math.min(e.first, d.line);
    }
  }
  out.files = [...seen.values()].map((e) => ({ file: e.file, count: e.count, codes: [...e.codes].sort(), line: e.first })).sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

/** create the reach-06 finding (approved by the wave-3 approval) -> {id} | null when there is no residue */
export async function createBridgeFinding({ root, runId }) {
  const run = readRun(root, runId);
  const { config } = loadConfig(root);
  const detect = await runDetect(root);
  const m = await measureResidue({ root, run, detect, config });
  if (!m.files.length) return { finding: null, measured: m };
  const lintUsable = !!detect.lint?.usable;
  const first = m.files[0];
  const pkg = (detect.packages || []).find((p) => p.path !== '.' && first.file.startsWith(p.path + '/'))?.path || '.';
  const front = addFinding({
    root, runId, detect, cand: { rule: 'reach-06', file: first.file, line: first.line, package: pkg, engine: 'tsc', severity_hint: 'warn', fix_risk_hint: 'low', fingerprint: fingerprintOf({ rule: 'reach-06', package: pkg, file: first.file, symbol: 'bridge', snippet: '' }) },
    origin: 'bridge', wave: 'B', touches: m.files.map((f) => f.file),
    reason: `${m.diagnostics.length} unused-local diagnostic(s) in ${m.files.length} file(s) changed by this run`,
    evidence: m.diagnostics.slice(0, 8).map((d) => `${d.file}:${d.line} ${d.code} ${d.message}`.slice(0, 200)),
    confidence: 'certain', fixMode: lintUsable ? 'auto' : 'assisted',
  });
  updateFinding(root, runId, front.id, (fm) => { fm.state = 'approved'; });
  // covered by the wave-3 approval: record it in the lock, not as a new user decision
  const lockFile = join(runDir(root, runId), 'plan.lock.json');
  if (isFile(lockFile)) {
    const lk = readJsonc(lockFile).value;
    lk.approved.push(front.id); lk.amendments.push({ at: nowIso(), ids: [front.id], by: 'bridge' });
    writeAtomic(lockFile, JSON.stringify(lk, null, 2) + '\n');
  }
  const idxFile = join(runDir(root, runId), 'findings', 'index.json');
  if (isFile(idxFile)) {
    const idx = readJsonc(idxFile).value;
    for (const r of idx.findings) if (r.id === front.id) r.state = 'approved';
    idx.counts.by_state = {}; for (const r of idx.findings) idx.counts.by_state[r.state] = (idx.counts.by_state[r.state] || 0) + 1;
    writeAtomic(idxFile, JSON.stringify(idx, null, 2) + '\n');
  }
  stampLog(root, runId, { ev: 'bridge', finding: front.id, files: m.files.map((f) => f.file), diagnostics: m.diagnostics.length, fix_mode: front.fix_mode });
  return { finding: front, measured: m };
}
