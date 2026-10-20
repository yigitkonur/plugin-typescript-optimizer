// ts-opt plan lock|status|check|amend — the approval surface (doc 04 §5).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWaves, parseChecks, eligible } from '../artifacts/plan.mjs';
import { readRun, resolveRunId, runDir, stampLog, writeRun } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, readJsonc, readText, writeAtomic } from '../core/fs.mjs';
import { listFindings, updateFinding } from '../gate/findings.mjs';
import { findRoot } from '../detect/root.mjs';

export const spec = { risk: 'string', mode: 'string', rule: 'string', wave: 'string', cascade: 'boolean', off: 'boolean', approve: 'boolean' };
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function syncIndex(root, id, states) {
  const f = join(runDir(root, id), 'findings', 'index.json');
  if (!isFile(f)) return;
  const idx = readJsonc(f).value;
  for (const row of idx.findings) if (states.has(row.id)) row.state = states.get(row.id);
  idx.counts.by_state = {};
  for (const row of idx.findings) idx.counts.by_state[row.state] = (idx.counts.by_state[row.state] || 0) + 1;
  writeAtomic(f, JSON.stringify(idx, null, 2) + '\n');
}

export async function run({ cwd, flags, args }) {
  const sub = args[0];
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  const rd = runDir(root, id);
  const planFile = join(rd, 'plan.md');
  const runObj = readRun(root, id);
  if (sub === 'lock') return lock(root, id, rd, planFile, runObj);
  if (sub === 'status') return status(root, id, rd, planFile, runObj);
  if (sub === 'check') return check(root, id, planFile, runObj, flags);
  if (sub === 'amend') return amend(root, id, rd, planFile, runObj, args.slice(1), flags);
  throw new TsOptError(EXIT.USAGE, 'usage: ts-opt plan lock|status|check|amend');
}

function lock(root, id, rd, planFile, runObj) {
  if (runObj.state !== 'ready') throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; the plan can only be locked from "ready"`, runObj.state === 'planned' ? 'run `ts-opt run begin` first: it checks the tree, the branch and the baseline' : runObj.state === 'locked' ? 'the plan is already locked; use `ts-opt plan amend` for later approvals' : null);
  const text = readText(planFile);
  if (text === null) throw new TsOptError(EXIT.ARTIFACT, 'plan.md is missing');
  const checks = parseChecks(text);
  const findings = listFindings(root, id);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const problems = [];
  for (const c of checks.filter((x) => x.checked)) {
    const f = byId.get(c.id);
    if (!f) problems.push({ id: c.id, reason: 'no such finding' });
    else if (!eligible(f.front)) problems.push({ id: c.id, reason: f.front.wave === null ? 'wave not schedulable in this run (mode, or no test leg: only waves B and 4 can run without tests)' : f.front.fix_mode === 'flag-only' ? 'flag-only findings are never applied' : f.front.confidence === 'speculative' ? 'speculative findings are never applied' : `state ${f.front.state}` });
  }
  if (problems.length) throw new TsOptError(EXIT.PRECONDITION, `${problems.length} checked finding(s) cannot be approved:\n` + problems.map((p) => `  ${p.id}: ${p.reason}`).join('\n'), 'untick them in plan.md');
  const checked = new Set(checks.filter((c) => c.checked).map((c) => c.id));
  const approved = []; const skipped = []; const states = new Map();
  for (const f of findings) {
    if (!eligible(f.front)) continue;
    const st = checked.has(f.id) ? 'approved' : 'skipped';
    updateFinding(root, id, f.id, (fm) => { fm.state = st; });
    states.set(f.id, st); (st === 'approved' ? approved : skipped).push(f.id);
  }
  syncIndex(root, id, states);
  const hash = sha256(text);
  const lockedAt = nowIso();
  writeAtomic(join(rd, 'plan.lock.json'), JSON.stringify({ schema: 'ts-optimize/plan-lock@1', run: id, approved, plan_sha256: hash, locked_at: lockedAt, amendments: [] }, null, 2) + '\n');
  runObj.state = 'locked';
  runObj.waves = buildWaves(findings, states, runObj.mode, []); // at the lock only waves with approved work (plus the implicit bridge) exist
  runObj.approvals = { locked_at: lockedAt, approved, skipped, amendments: [] };
  writeRun(root, runObj);
  const notEligible = findings.filter((f) => !eligible(f.front) && f.front.state !== 'superseded').length;
  return { result: { approved: approved.length, skipped: skipped.length, not_eligible: notEligible, approved_ids: approved, hash }, text: `locked: ${approved.length} approved, ${skipped.length} skipped, ${notEligible} not eligible (flag-only, speculative or unscheduled)\nnext: ts-opt run wave begin ${runObj.waves?.[0]?.id ?? '<wave>'}  (the fix skill does this)` };
}

function status(root, id, rd, planFile, runObj) {
  const lk = isFile(join(rd, 'plan.lock.json')) ? readJsonc(join(rd, 'plan.lock.json')).value : null;
  const text = readText(planFile) || '';
  const checks = parseChecks(text);
  const drift = lk ? sha256(text) !== lk.plan_sha256 : false;
  const findings = listFindings(root, id);
  const by = {};
  for (const f of findings) by[f.front.state] = (by[f.front.state] || 0) + 1;
  return { result: { run: id, state: runObj.state, locked: !!lk, drift, checked: checks.filter((c) => c.checked).length, boxes: checks.length, approved: lk?.approved?.length ?? 0, amendments: lk?.amendments?.length ?? 0, by_state: by }, text: `run ${id}: ${runObj.state}\n${lk ? `locked ${lk.locked_at}: ${lk.approved.length} approved, ${lk.amendments.length} amendment(s)${drift ? '\nplan.md was edited after the lock: edits are ignored' : ''}` : `not locked: ${checks.filter((c) => c.checked).length} of ${checks.length} boxes ticked`}\nstates: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ')}` };
}

function check(root, id, planFile, runObj, flags) {
  if (!['planned', 'ready'].includes(runObj.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; boxes can only be changed before the lock`);
  const byId = new Map(listFindings(root, id).map((f) => [f.id, f.front]));
  const lines = (readText(planFile) || '').split('\n');
  let n = 0;
  const out = lines.map((l) => {
    const m = /^- \[( |x|X)\] (F-\d{4})\b/.exec(l);
    if (!m) return l;
    const f = byId.get(m[2]);
    if (!f || !eligible(f)) return l;
    if (flags.risk && f.fix_risk !== flags.risk) return l;
    if (flags.mode && f.fix_mode !== flags.mode) return l;
    if (flags.rule && f.rule !== flags.rule) return l;
    if (flags.wave && String(f.wave) !== flags.wave) return l;
    if (flags.cascade && !String(f.origin || '').startsWith('cascade:')) return l;
    n++;
    return l.replace(/^- \[.\]/, flags.off ? '- [ ]' : '- [x]');
  });
  writeAtomic(planFile, out.join('\n'));
  return { result: { changed: n }, text: `${flags.off ? 'unticked' : 'ticked'} ${n} box(es) in plan.md` };
}

function amend(root, id, rd, planFile, runObj, ids, flags) {
  if (!['locked', 'applying', 'verifying'].includes(runObj.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; amend is for findings added after the lock`, 'before the lock, tick the box in plan.md or use `ts-opt plan check`');
  const findings = listFindings(root, id);
  let target = ids;
  if (flags.cascade) target = findings.filter((f) => String(f.front.origin || '').startsWith('cascade:') && f.front.state === 'open' && eligible({ ...f.front, state: 'open' })).map((f) => f.id);
  if (!target.length) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt plan amend F-0021 [F-0022 …]   or   ts-opt plan amend --cascade');
  const lockFile = join(rd, 'plan.lock.json');
  const lk = readJsonc(lockFile).value;
  const states = new Map(); const done = [];
  for (const fid of target) {
    const f = findings.find((x) => x.id === fid);
    if (!f) throw new TsOptError(EXIT.NOTHING, `no finding ${fid}`);
    if (f.front.state === 'approved') continue;
    if (!eligible({ ...f.front, state: 'open' }) || f.front.state !== 'open') throw new TsOptError(EXIT.PRECONDITION, `${fid} cannot be approved (state ${f.front.state}, wave ${f.front.wave}, ${f.front.fix_mode}, ${f.front.confidence})`);
    updateFinding(root, id, fid, (fm) => { fm.state = 'approved'; });
    states.set(fid, 'approved'); done.push(fid); lk.approved.push(fid);
  }
  const at = nowIso();
  lk.amendments.push({ at, ids: done, by: 'user-confirmed' });
  lk.plan_sha256 = sha256((readText(planFile) || '') + '\n' + lk.approved.join(','));
  writeAtomic(lockFile, JSON.stringify(lk, null, 2) + '\n');
  runObj.approvals = { ...(runObj.approvals || {}), approved: lk.approved, amendments: lk.amendments };
  runObj.waves = buildWaves(listFindings(root, id), states, runObj.mode, runObj.waves);
  writeRun(root, runObj);
  syncIndex(root, id, states);
  stampLog(root, id, { ev: 'amend', ids: done, by: 'user-confirmed' });
  return { result: { amended: done, hash: lk.plan_sha256 }, text: `approved after the lock: ${done.join(', ') || '(already approved)'}` };
}
