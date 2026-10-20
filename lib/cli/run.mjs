// ts-opt run begin|status|finish|abort|prune|wave begin|wave end — the run state machine (doc 04 §4.2).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, workBranch } from '../artifacts/config.mjs';
import { eligible } from '../artifacts/plan.mjs';
import { staleCheck } from '../artifacts/stale.mjs';
import { ART, OPEN_STATES, clearOpenRun, listRuns, openRunId, readRun, resolveRunId, runDir, setOpenRun, stampLog, writeRun } from '../artifacts/store.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile, mkdirp, readJsonc, readText, writeAtomic } from '../core/fs.mjs';
import { statusPaths } from '../core/git.mjs';
import { run as runProc } from '../core/proc.mjs';
import { WAVE_ORDER } from '../catalog/index.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { listFindings, refreshIndex } from '../gate/findings.mjs';
import { divergenceNote } from '../gate/divergence.mjs';
import { worktreeFingerprint } from '../gate/fingerprint.mjs';
import { withRunLock } from '../gate/lock.mjs';

export const spec = { 'allow-red-baseline': 'array', keep: 'number', reason: 'string', waves: 'array' };

const git = (root, args, o = {}) => runProc(['git', ...args], { cwd: root, timeoutMs: 30_000, ...o });
const gitOut = async (root, args) => { const r = await git(root, args); return r.code === 0 ? r.stdout.trim() : null; };

export async function run({ cwd, flags, args }) {
  const sub = args[0];
  const { root } = await findRoot(cwd);
  if (!['begin', 'status', 'finish', 'abort', 'prune', 'wave'].includes(sub)) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt run begin|status|finish|abort|prune|wave begin <id>|wave end <id>');
  const id = resolveRunId(root, flags.run);
  if (sub === 'status') return status(root, id);
  if (sub === 'begin') return withRunLock(root, id, 'run begin', () => begin(root, id, flags));
  if (sub === 'wave') return withRunLock(root, id, `run wave ${args[1]}`, () => wave(root, id, args[1], args[2], flags));
  if (sub === 'finish') return withRunLock(root, id, 'run finish', () => finish(root, id));
  if (sub === 'abort') return withRunLock(root, id, 'run abort', () => abort(root, id, flags));
  return prune(root, flags);
}

// ------------------------------------------------------------------------------------------------ begin
async function begin(root, id, flags) {
  const run = readRun(root, id);
  if (run.state !== 'planned') throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; "run begin" needs a planned (audited) run`, run.state === 'scanning' || run.state === 'triaging' ? 'the audit did not finish: re-run /ts-optimize:audit (it resumes)' : null);
  const d = await detect(root);
  const { config } = loadConfig(root);
  if (!d.git.repo) throw new TsOptError(EXIT.PRECONDITION, 'not a git repository: fixing needs git for commits, tags and rollback', 'run `git init` and commit your work, or use the audit only');
  const dirty = (await statusPaths(root)) || [];
  if (dirty.length) throw new TsOptError(EXIT.PRECONDITION, `the working tree has ${dirty.length} uncommitted change(s): ${dirty.slice(0, 8).map((x) => x.path).join(', ')}${dirty.length > 8 ? ', …' : ''}`, 'commit or stash them; the findings stay on disk (.ts-optimize/ is ignored by this check)');
  if (!d.gate.legs.some((l) => l.id === 'typecheck')) throw new TsOptError(EXIT.CAPABILITY, 'no typecheck leg is available for this project: nothing can be verified, so fix refuses', 'add a tsconfig.json (see `ts-opt doctor`)');

  const head = await gitOut(root, ['rev-parse', 'HEAD']);
  if (!head) throw new TsOptError(EXIT.PRECONDITION, 'the repository has no commits yet');
  const cur = d.git.branch;
  const base = run.repo?.default_branch || 'main';
  let branch = cur;
  let branchCreated = false;
  if (cur === base || cur === 'HEAD') {
    const prefix = workBranch(config, run.mode);
    branch = prefix;
    for (let n = 2; (await gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== null; n++) branch = `${prefix}-${n}`;
    const r = await git(root, ['checkout', '-b', branch]);
    if (r.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `could not create branch ${branch}: ${r.stderr.trim()}`);
    branchCreated = true;
  }
  const stale = await staleCheck(root, id, { apply: true });

  let baselineSummary = null;
  try {
    const { captureBaseline } = await import('../gate/baseline.mjs');
    baselineSummary = await captureBaseline({ root, runId: id, detect: d, allowRed: flags['allow-red-baseline'] || [] });
  } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND') throw new TsOptError(EXIT.INTERNAL, 'gate engine is not installed in this plugin build');
    if (cur === base || cur === 'HEAD') { await git(root, ['checkout', cur === 'HEAD' ? head : cur]); await git(root, ['branch', '-D', branch]); } // leave the repo as we found it
    throw e;
  }
  const fresh = readRun(root, id);
  fresh.state = 'ready';
  fresh.applying = { wave: null, pass: 1, finding: null, branch, base: head, branch_created: branchCreated };
  writeRun(root, fresh);
  setOpenRun(root, id);
  stampLog(root, id, { ev: 'run-begin', branch, base: head, baseline: baselineSummary ? { status: baselineSummary.status } : null });
  return {
    result: { run: id, state: 'ready', branch, base: head, stale: stale.stale, baseline: baselineSummary },
    text: [`run ${id} is ready on branch ${branch} (base ${head.slice(0, 7)})`, stale.stale.length ? `stale (files changed since the audit, removed from the plan): ${stale.stale.map((s) => s.id).join(', ')}` : null, baselineSummary ? `baseline: ${baselineSummary.status}` : null, 'next: review the plan, then `ts-opt plan lock`'].filter(Boolean).join('\n'),
    next_actions: [{ cmd: 'ts-opt plan lock', why: 'approve the ticked boxes and lock the plan' }],
  };
}

// ------------------------------------------------------------------------------------------------ status
async function status(root, id) {
  const run = readRun(root, id);
  const waves = run.waves || [];
  const done = waves.filter((w) => w.status === 'gated').map((w) => w.id);
  const notDone = (w) => !['gated', 'skipped'].includes(w.status) || (w.late && approvedLeft(w.id));
  const approvedLeft = (wid) => listFindings(root, id).some((f) => String(f.front.wave) === String(wid) && f.front.state === 'approved');
  const pending = [...waves.filter((w) => !w.late && notDone(w)), ...waves.filter((w) => w.late && notDone(w))].map((w) => w.id);
  const dirty = ((await statusPaths(root)) || []).length;
  const lastGreen = [...waves].reverse().find((w) => w.gate?.passed)?.id ?? null;
  const approved = listFindings(root, id).filter((f) => f.front.state === 'approved');
  const repeat = waves.filter((w) => w.late && notDone(w)).map((w) => w.id);
  const result = { run: id, state: run.state, mode: run.mode, repeat_pending: repeat, branch: run.applying?.branch ?? run.repo?.branch ?? null, base: run.applying?.base ?? null, waves_pending: pending, waves_done: done, finding_in_progress: run.applying?.finding ?? null, wave: run.applying?.wave ?? null, pass: run.applying?.pass ?? 1, uncommitted_files: dirty, last_green_wave: lastGreen, approved_pending: approved.length };
  const text = `run ${id}: ${run.state}${result.wave ? ` · wave ${result.wave}` : ''}${result.finding_in_progress ? ` · ${result.finding_in_progress} in progress` : ''}\nbranch ${result.branch ?? '-'} · waves pending [${pending.join(',')}] done [${done.join(',')}]${repeat.length ? ` repeat-pass [${repeat.join(',')}]` : ''} · ${dirty} uncommitted file(s) · last green wave ${lastGreen ?? '-'}`;
  return { result, text };
}

// ------------------------------------------------------------------------------------------------ waves
const orderIdx = (w) => { const i = WAVE_ORDER.indexOf(String(w)); return i < 0 ? 99 : i; };

async function wave(root, id, action, wid, flags) {
  if (!['begin', 'end'].includes(action) || !wid) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt run wave begin|end <id>');
  const run = readRun(root, id);
  const w = (run.waves || []).find((x) => String(x.id) === String(wid));
  if (action === 'begin') {
    if (!['locked', 'applying'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; waves start from "locked" (approval always precedes any edit)`, run.state === 'ready' ? 'review plan.md and run `ts-opt plan lock`' : run.state === 'planned' ? 'run `ts-opt run begin` first' : null);
    if (!w) throw new TsOptError(EXIT.NOTHING, `wave ${wid} has no approved findings in this run (waves: ${(run.waves || []).map((x) => x.id).join(', ')})`);
    if (run.applying?.wave && run.applying.wave !== String(wid) && (run.waves.find((x) => String(x.id) === run.applying.wave)?.status === 'running')) throw new TsOptError(EXIT.PRECONDITION, `wave ${run.applying.wave} is still running: gate it and run \`ts-opt run wave end ${run.applying.wave}\` first`);
    const all = listFindings(root, id);
    const approvedIn = (x) => all.filter((f) => String(f.front.wave) === String(x) && f.front.state === 'approved');
    const late = !!w.late;
    if (late) {
      const regular = run.waves.filter((x) => !x.late && !['gated', 'skipped'].includes(x.status));
      if (regular.length) throw new TsOptError(EXIT.PRECONDITION, `wave ${wid} is a repeat pass (cascade work behind waves that already ran); it starts after the regular waves: ${regular.map((x) => x.id).join(', ')} first`, `run wave ${regular[0].id} first`);
    }
    for (const earlier of run.waves.filter((x) => orderIdx(x.id) < orderIdx(wid) && (late || !x.late))) {
      const open = approvedIn(earlier.id);
      if (open.length) throw new TsOptError(EXIT.PRECONDITION, `wave ${earlier.id} still has ${open.length} approved finding(s)${earlier.status === 'gated' ? ' (repeat pass)' : ' and has not passed its gate'}; waves run in causal order`, `run wave ${earlier.id} first`);
    }
    if (w.status === 'running') throw new TsOptError(EXIT.PRECONDITION, `wave ${wid} is already running; continue with its findings (starting it again would move the tag that bisect and rollback use as the base)`, 'ts-opt run status --json');
    const repeat = w.status === 'gated';
    if (repeat && !approvedIn(wid).length) throw new TsOptError(EXIT.NOTHING, `wave ${wid} already passed its gate and has no new approved findings`);
    if (repeat && (w.pass || 1) >= 3) throw new TsOptError(EXIT.PRECONDITION, `wave ${wid} already ran ${w.pass} passes; what still cascades is residual and is reported, not fixed`);
    if (String(wid) === 'B' && !approvedIn('B').length) {
      const { createBridgeFinding } = await import('../gate/bridge.mjs');
      const b = await createBridgeFinding({ root, runId: id });
      if (!b.finding) {
        const fresh = readRun(root, id);
        const fw = fresh.waves.find((x) => String(x.id) === 'B');
        fw.status = 'gated'; fw.skipped = 'no unused-local residue'; fw.gate = { passed: true, skipped: true, reason: 'no unused-local residue in the files this run changed' };
        writeRun(root, fresh);
        stampLog(root, id, { ev: 'wave-skip', wave: 'B', reason: 'no residue', measured: { changed: b.measured.changed, skipped: b.measured.skipped } });
        return { result: { wave: 'B', skipped: true, reason: 'no unused-local residue', findings: [], measured: { changed: b.measured.changed, legs: b.measured.legs, skipped: b.measured.skipped, diagnostics: (b.measured.diagnostics || []).length } }, text: `wave B skipped: no unused-local residue in the ${b.measured.changed} file(s) this run changed${b.measured.skipped.length ? '\n' + b.measured.skipped.join('\n') : ''}\nnext: \`ts-opt run status\`` };
      }
    }
    const stale = await staleCheck(root, id, { apply: true });
    const pass = repeat ? (w.pass || 1) + 1 : 1;
    const tag = `ts-optimize/${id}/wave-${wid}-start${pass > 1 ? `-p${pass}` : ''}`;
    const t = await git(root, ['tag', '-f', tag]);
    if (t.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `could not tag ${tag}: ${t.stderr.trim()}`);
    run.state = 'applying';
    run.applying = { ...(run.applying || {}), wave: String(wid), pass, finding: null };
    w.status = 'running'; w.tag = tag; w.gate = null; w.pass = pass;
    writeRun(root, run);
    stampLog(root, id, { ev: 'wave-begin', wave: String(wid), pass, tag });
    const list = listFindings(root, id).filter((f) => String(f.front.wave) === String(wid) && f.front.state === 'approved');
    const ordered = orderByDependency(list);
    return { result: { wave: String(wid), pass, tag, findings: ordered.map((f) => f.id), stale: stale.stale }, text: `wave ${wid} begun (tag ${tag}): ${ordered.map((f) => f.id).join(', ') || 'no approved findings'}${stale.stale.length ? `\nstale, removed: ${stale.stale.map((s) => s.id).join(', ')}` : ''}` };
  }
  // end
  if (!w) throw new TsOptError(EXIT.NOTHING, `wave ${wid} is not part of this run`);
  if (!w.gate || w.gate.passed !== true) throw new TsOptError(EXIT.PRECONDITION, `the gate for wave ${wid} has not passed`, `run \`ts-opt gate --wave ${wid}\`; on red use bisect + revert, never loosen the gate`);
  const left = listFindings(root, id).filter((f) => String(f.front.wave) === String(wid) && f.front.state === 'approved');
  if (left.length) throw new TsOptError(EXIT.PRECONDITION, `wave ${wid} still has ${left.length} approved finding(s) that are neither applied nor reverted nor skipped: ${left.map((f) => f.id).join(', ')}`, 'apply them (`ts-opt commit`), or `ts-opt findings skip F-… --reason "…"` for one the audit got wrong');
  w.status = 'gated'; delete w.late;
  refreshIndex(root, id);
  run.applying = { ...run.applying, finding: null };
  writeRun(root, run);
  stampLog(root, id, { ev: 'wave-end', wave: String(wid), pass: run.applying?.pass ?? 1, tag: w.tag });
  const pending = [...run.waves.filter((x) => !x.late && !['gated', 'skipped'].includes(x.status)), ...run.waves.filter((x) => x.late && x.id !== w.id)].map((x) => x.id);
  return { result: { wave: String(wid), status: 'gated', waves_pending: pending }, text: `wave ${wid} gated${pending.length ? `; next: ${pending[0]}` : '; all waves done: run the post-flight (`ts-opt gate --wave P`) and `ts-opt run finish`'}` };
}

export function orderByDependency(list) {
  const byId = new Map(list.map((f) => [f.id, f]));
  const out = []; const seen = new Set();
  const visit = (f) => { if (seen.has(f.id)) return; seen.add(f.id); for (const d of f.front.depends_on || []) if (byId.has(d)) visit(byId.get(d)); out.push(f); };
  for (const f of [...list].sort((a, b) => a.id.localeCompare(b.id))) visit(f);
  return out;
}

// ------------------------------------------------------------------------------------------------ finish
async function finish(root, id) {
  const run = readRun(root, id);
  if (run.state !== 'verifying') throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; "run finish" needs a green post-flight gate`, 'run `ts-opt gate --wave P` first (it moves the run to "verifying" when green)');
  const fingerprint = await worktreeFingerprint(root);
  if (!run.post_flight?.passed || run.post_flight.fingerprint !== fingerprint) throw new TsOptError(EXIT.PRECONDITION, `the latest post-flight gate ${run.post_flight ? (run.post_flight.passed ? 'was for a different worktree (code changed since)' : 'failed') : 'has not run'}; "run finish" needs a green gate P at the current state`, 'run `ts-opt gate --wave P` again');
  const unfinished = listFindings(root, id).filter((f) => f.front.state === 'approved');
  if (unfinished.length) throw new TsOptError(EXIT.PRECONDITION, `${unfinished.length} approved finding(s) are neither applied, reverted nor skipped: ${unfinished.map((f) => f.id).slice(0, 8).join(', ')}`, 'apply them, or `ts-opt findings skip F-… --reason "…"`, then run the gate P again');
  const running = (run.waves || []).filter((x) => x.status === 'running').map((x) => x.id);
  if (running.length) throw new TsOptError(EXIT.PRECONDITION, `wave ${running.join(', ')} has not ended`, 'gate it and run `ts-opt run wave end`');
  const { config } = loadConfig(root);
  refreshIndex(root, id);
  const findings = listFindings(root, id);
  const log = readLog(root, id);
  const commitOf = new Map();
  for (const e of log) if (e.ev === 'commit') for (const fid of e.ids || []) commitOf.set(fid, e);
  const gateOf = new Map((run.waves || []).map((w) => [String(w.id), w.gate]));
  const rows = findings.filter((f) => ['applied', 'reverted'].includes(f.front.state));
  const row = (f) => {
    const c = commitOf.get(f.id); const g = gateOf.get(String(f.front.wave));
    return `| ${f.id} | ${f.front.rule} | ${c ? '`' + String(c.sha).slice(0, 7) + '`' : '-'} | ${(c?.files || f.front.touches || []).slice(0, 4).map((x) => '`' + x + '`').join(', ')} | ${c ? 'pass' : '-'} | ${g ? (g.passed ? `wave-${f.front.wave} pass` : `wave-${f.front.wave} fail`) : '-'} | ${f.front.state} |`;
  };
  const counts = (st) => findings.filter((f) => f.front.state === st).length;
  const ledger = ['# Apply ledger', '', `run ${id} · branch ${run.applying?.branch ?? '-'} · base ${(run.applying?.base ?? '').slice(0, 7)}`, '', '| Finding | Rule | Commit | Files | Fast-check | Wave gate | Outcome |', '|---|---|---|---|---|---|---|', ...rows.map(row), ''].join('\n');
  mkdirp(join(runDir(root, id), 'apply'));
  writeAtomic(join(runDir(root, id), 'apply', 'ledger.md'), ledger);

  const pGate = run.post_flight || gateOf.get('P');
  const untraced = pGate?.untraced || [];
  const outcome = ['', '## Outcome', '', `- applied ${counts('applied')} · reverted ${counts('reverted')} · skipped ${counts('skipped')} · deferred/flag-only ${findings.filter((f) => f.front.fix_mode === 'flag-only' || f.front.verdict === 'deferred').length}`,
    `- final gate (P): ${pGate?.passed ? 'passed' : 'not recorded'}${pGate?.legs ? ' — ' + Object.entries(pGate.legs).map(([k, v]) => `${k} ${typeof v === 'string' ? v : v.status}`).join(', ') : ''}`,
    `- untraced commits: ${untraced.length ? untraced.join(', ') : 'none'}`, ...(divergenceNote(root, id) ? [`- ${divergenceNote(root, id)}`] : []), `- ledger: apply/ledger.md`, ''].join('\n');
  const sum = join(runDir(root, id), 'SUMMARY.md');
  if (isFile(sum)) writeAtomic(sum, (readText(sum) || '').replace(/\n## Outcome[\s\S]*$/, '') + outcome);
  const q = join(root, '.quarantine');
  if (existsSync(q)) {
    const items = (await git(root, ['ls-files', '--', '.quarantine'])).stdout.split('\n').filter(Boolean);
    writeAtomic(join(q, 'README.md'), ['# Quarantine', '', 'Files moved here by ts-optimize because a dynamic or framework consumer was plausible. Verify in a preview deployment, then delete with `git rm -r .quarantine/<item>`.', '', ...items.filter((x) => x !== '.quarantine/README.md').map((x) => `- \`${x.replace('.quarantine/', '')}\``), ''].join('\n'));
  }
  run.state = 'done'; run.finished = nowIso();
  writeRun(root, run);
  clearOpenRun(root);
  stampLog(root, id, { ev: 'finish', ledger: 'apply/ledger.md', outcome: { applied: counts('applied'), reverted: counts('reverted'), skipped: counts('skipped') } });

  let artifactsCommit = null;
  if (config.commit.artifacts !== false) {
    await git(root, ['add', '--', ART, ...(existsSync(q) ? ['.quarantine/README.md'] : [])]);
    const staged = (await git(root, ['diff', '--cached', '--name-only'])).stdout.trim();
    if (staged) {
      const c = await git(root, ['commit', '-m', `chore(ts-optimize): record run ${id}`, '-m', `Run: ${id}`], { env: {} });
      if (c.code === 0) artifactsCommit = (await gitOut(root, ['rev-parse', '--short', 'HEAD']));
    }
  }
  return { result: { run: id, state: 'done', ledger: `${ART}/runs/${id}/apply/ledger.md`, applied: counts('applied'), reverted: counts('reverted'), skipped: counts('skipped'), artifacts_commit: artifactsCommit }, text: `run ${id} done: ${counts('applied')} applied, ${counts('reverted')} reverted, ${counts('skipped')} skipped\nledger: ${ART}/runs/${id}/apply/ledger.md${artifactsCommit ? `\nartifacts committed (${artifactsCommit})` : ''}`, next_actions: [{ cmd: 'ts-opt baseline --save', why: 'raise the ratchet floors to this green state (optional)' }] };
}

function readLog(root, id) {
  const f = join(runDir(root, id), 'apply', 'log.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
}

// ------------------------------------------------------------------------------------------------ abort / prune
async function abort(root, id, flags) {
  const run = readRun(root, id);
  if (!OPEN_STATES.has(run.state) && !['scanning', 'triaging'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}; nothing to abort`);
  const a = run.applying;
  const notes = [];
  if (a?.branch && a?.base) {
    const cur = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const ahead = Number((await gitOut(root, ['rev-list', '--count', `${a.base}..HEAD`])) || 0);
    if (cur === a.branch && ahead === 0 && a.branch_created === true) {
      const base = run.repo?.default_branch || 'main';
      const co = await git(root, ['checkout', base]);
      if (co.code === 0) { await git(root, ['branch', '-D', a.branch]); notes.push(`returned to ${base} and removed the empty branch ${a.branch}`); }
    } else notes.push(a.branch_created === true ? `branch ${a.branch} keeps ${ahead} commit(s); delete or reset it yourself` : `branch ${a.branch} was yours before this run and is left as it is (${ahead} commit(s) from this run)`);
  }
  for (const w of run.waves || []) if (w.tag && (await gitOut(root, ['rev-list', '--count', `${w.tag}..HEAD`])) === '0') await git(root, ['tag', '-d', w.tag]);
  run.state = 'aborted'; run.abort_reason = flags.reason || 'aborted by user';
  writeRun(root, run);
  clearOpenRun(root);
  stampLog(root, id, { ev: 'abort', reason: run.abort_reason });
  return { result: { run: id, state: 'aborted', notes }, text: `run ${id} aborted (${run.abort_reason}); artifacts remain in ${ART}/runs/${id}\n${notes.join('\n')}` };
}

function prune(root, flags) {
  const keep = flags.keep ?? loadConfig(root).config.keep_runs;
  const open = openRunId(root);
  const runs = listRuns(root).map((r) => ({ id: r, run: readRun(root, r) })).filter((x) => ['done', 'aborted'].includes(x.run.state) && x.id !== open).sort((a, b) => (a.run.created < b.run.created ? 1 : -1));
  const drop = runs.slice(keep);
  for (const x of drop) rmSync(runDir(root, x.id), { recursive: true, force: true });
  return { result: { kept: Math.min(keep, runs.length), removed: drop.map((x) => x.id) }, text: `removed ${drop.length} old run(s), kept ${Math.min(keep, runs.length)} (suppressions.json, baseline.json and config.json are never touched)` };
}
export { eligible, readJsonc, setOpenRun };
