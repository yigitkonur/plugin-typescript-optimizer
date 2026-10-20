// Test helper (NOT the product): craft the exact state `run begin` + `plan lock` + `run wave begin <w>` leave behind, without a gate.
//   const s = beginApplying(null, { approve: ['reach-04@src/internal.ts'], wave: '3' })   // audits F01 (scan -> verdicts -> ingest) first
// `approve` entries: an F-id, a rule id ("reach-04": first finding of that rule), "rule@file", or {select, patch} where patch is merged into the
// front matter first (used to make an otherwise report-only finding schedulable, e.g. F06 plat-* findings have wave null).
// State written (doc 04 §4.2, §5): finding front matter `state: approved`; plan.lock.json; run.json state/applying/approvals/waves;
// work branch chore/ts-cleanup + wave-start tag; state/open-run. Earlier waves are marked gated with a green gate unless earlierGreen is false.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WAVE_ORDER } from '../../lib/catalog/index.mjs';
import { readFinding, writeFinding } from '../../lib/artifacts/finding.mjs';
import { auditFixture, latestRun } from './fixrun.mjs';

export const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what} failed: ${r.stderr || r.stdout}`); return r.stdout.trim(); };

export const findingsDir = (work, runId) => join(work, '.ts-optimize', 'runs', runId, 'findings');
export function allFindings(work, runId) {
  const dir = findingsDir(work, runId);
  return readdirSync(dir).filter((f) => /^F-\d{4}\.md$/.test(f)).sort().map((f) => ({ file: join(dir, f), ...readFinding(join(dir, f)) }));
}
export const readF = (work, runId, id) => allFindings(work, runId).find((f) => f.front.id === id);

export function resolveSelector(work, runId, sel) {
  if (/^F-\d{4,}$/.test(sel)) return sel;
  const [rule, file] = sel.split('@');
  const hit = allFindings(work, runId).find((f) => f.front.rule === rule && (!file || f.front.location?.file === file));
  if (!hit) throw new Error(`no finding matches ${sel}`);
  return hit.front.id;
}

const orderIdx = (w) => { const i = WAVE_ORDER.indexOf(String(w)); return i < 0 ? 99 : i; };

export function beginApplying(work, { approve = [], wave = null, fixture = 'F01', audit = true, earlierGreen = true, config = null, branch = 'chore/ts-cleanup' } = {}) {
  const dir = audit ? auditFixture(fixture) : work;
  const runId = latestRun(dir);
  const wanted = approve.map((s) => (typeof s === 'string' ? { select: s, patch: {} } : s));
  const ids = wanted.map((w) => resolveSelector(dir, runId, w.select));
  wanted.forEach((w, i) => {
    const f = readF(dir, runId, ids[i]);
    Object.assign(f.front, w.patch || {});
    f.front.state = 'approved';
    writeFinding(f.file, f.front, f.body);
  });
  const cur = String(wave ?? readF(dir, runId, ids[0]).front.wave);
  const runPath = join(dir, '.ts-optimize', 'runs', runId, 'run.json');
  const run = JSON.parse(readFileSync(runPath, 'utf8'));

  must(git(dir, 'config', 'user.name', 'fixture'), 'git config');
  must(git(dir, 'config', 'user.email', 'fixture@example.invalid'), 'git config');
  must(git(dir, 'config', 'commit.gpgsign', 'false'), 'git config');
  must(git(dir, 'checkout', '-q', '-b', branch), 'git checkout -b');
  const base = must(git(dir, 'rev-parse', 'HEAD'), 'rev-parse');
  const tag = `ts-optimize/${runId}/wave-${cur}-start`;
  must(git(dir, 'tag', '-f', tag), 'git tag');

  const plan = readFileSync(join(dir, '.ts-optimize', 'runs', runId, 'plan.md'), 'utf8');
  const lockedAt = new Date().toISOString();
  writeFileSync(join(dir, '.ts-optimize', 'runs', runId, 'plan.lock.json'), JSON.stringify({ schema: 'ts-optimize/plan-lock@1', run: runId, approved: ids, plan_sha256: createHash('sha256').update(plan).digest('hex'), locked_at: lockedAt, amendments: [] }, null, 2) + '\n');
  run.state = 'applying';
  run.approvals = { locked_at: lockedAt, approved: ids, skipped: [], amendments: [] };
  run.applying = { wave: cur, pass: 1, finding: null, branch, base };
  run.waves = (run.waves || []).map((w) => {
    if (String(w.id) === cur) return { ...w, status: 'running', tag, gate: null };
    if (earlierGreen && orderIdx(w.id) < orderIdx(cur)) return { ...w, status: 'gated', tag: null, gate: { passed: true, wave: String(w.id), legs: {} } };
    return w;
  });
  writeFileSync(runPath, JSON.stringify(run, null, 2) + '\n');
  mkdirSync(join(dir, '.ts-optimize', 'state'), { recursive: true });
  writeFileSync(join(dir, '.ts-optimize', 'state', 'open-run'), runId + '\n');
  if (config) writeFileSync(join(dir, '.ts-optimize', 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return { work: dir, runId, ids, wave: cur, branch, base, tag };
}

export const runJson = (work, runId) => JSON.parse(readFileSync(join(work, '.ts-optimize', 'runs', runId, 'run.json'), 'utf8'));
export const writeRunJson = (work, runId, run) => writeFileSync(join(work, '.ts-optimize', 'runs', runId, 'run.json'), JSON.stringify(run, null, 2) + '\n');
export const logEvents = (work, runId) => {
  try { return readFileSync(join(work, '.ts-optimize', 'runs', runId, 'apply', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
