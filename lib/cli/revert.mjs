// ts-opt revert <F-id> [--reason "…"]: undo the commit of one finding (and every finding that shared it) (doc 02 §3.2, doc 04 §3.5, doc 06 §5).
import { loadConfig } from '../artifacts/config.mjs';
import { writeFinding } from '../artifacts/finding.mjs';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { findRoot } from '../detect/root.mjs';
import { readLog } from '../gate/bisect.mjs';
import { parseStatusZ } from '../gate/commit-policy.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { getSection, git, gitOut, setSection } from './commit.mjs';

export const spec = { reason: 'string' };

const tail = (s, n = 30) => String(s || '').trim().split('\n').slice(-n).join('\n').slice(-3000);

/** commits that carry a finding, oldest first: applied.commit, else commit events, else the Finding: trailer */
async function commitsOf(root, runId, finding) {
  const out = [];
  const add = async (ref) => {
    const full = await gitOut(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (full && !out.includes(full)) out.push(full);
  };
  if (finding.front.applied?.commit) await add(finding.front.applied.commit);
  if (!out.length) for (const e of readLog(root, runId)) if (e.ev === 'commit' && (e.ids || [e.id]).includes(finding.id) && e.sha) await add(e.sha);
  if (!out.length) {
    const r = await git(root, ['log', 'HEAD', '--format=%H', '--grep', `^Finding: ${finding.id}$`]);
    if (r.code === 0) for (const h of r.stdout.split('\n').filter(Boolean)) await add(h);
  }
  const ordered = [];
  const rl = await git(root, ['rev-list', '--reverse', 'HEAD']);
  const pos = new Map(rl.stdout.split('\n').filter(Boolean).map((h, i) => [h, i]));
  for (const h of out) if (pos.has(h)) ordered.push(h);
  return ordered.sort((a, b) => pos.get(a) - pos.get(b));
}

export async function run({ cwd, flags, args }) {
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '') || args.length > 1) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt revert F-0007 [--reason "why"]');
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  return withRunLock(root, runId, 'revert', () => revert(root, runId, fid, flags.reason ? String(flags.reason).replace(/\s+/g, ' ').trim().slice(0, 300) : 'reverted by user'));
}

async function revert(root, runId, fid, reason) {
  const run0 = readRun(root, runId);
  if (!['applying', 'verifying'].includes(run0.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${run0.state}; revert works while a run is applying or verifying`);
  if (run0.applying?.branch) {
    const branch = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== run0.applying.branch) throw new TsOptError(EXIT.PRECONDITION, `on branch ${branch}, but run ${runId} applies on ${run0.applying.branch}`, `git switch ${run0.applying.branch}`);
  }
  const finding = getFinding(root, runId, fid);
  if (finding.front.state === 'reverted') throw new TsOptError(EXIT.PRECONDITION, `${fid} is already reverted`);
  if (finding.front.state !== 'applied') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${finding.front.state}; only applied findings have a commit to revert`);
  const st = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const dirty = st.code === 0 ? parseStatusZ(st.stdout) : [];
  if (dirty.length) throw new TsOptError(EXIT.PRECONDITION, `the working tree has ${dirty.length} uncommitted change(s): ${dirty.slice(0, 6).map((d) => d.path).join(', ')}`, 'commit or stash them first; a revert needs a clean tree');

  const shas = await commitsOf(root, runId, finding);
  if (!shas.length) throw new TsOptError(EXIT.NOTHING, `no commit found for ${fid} (applied.commit, the apply log and Finding: trailers were all empty)`);

  // every finding that shared the commit(s) goes down with it
  const members = new Set([fid]);
  const log = readLog(root, runId);
  for (const sha of shas) {
    const msg = (await gitOut(root, ['log', '-1', '--format=%B', sha])) || '';
    for (const m of msg.matchAll(/^Finding:\s*(F-\d{4,})\s*$/gm)) members.add(m[1]);
    for (const e of log) if (e.ev === 'commit' && e.sha && sha.startsWith(String(e.sha))) for (const i of e.ids || []) members.add(i);
  }
  const memberFindings = [...members].sort().map((id) => { try { return getFinding(root, runId, id); } catch { return null; } }).filter(Boolean);

  const start = await gitOut(root, ['rev-parse', 'HEAD']);
  for (const sha of [...shas].reverse()) {
    const r = await git(root, ['revert', '--no-edit', sha], { timeoutMs: 300_000 });
    if (r.code !== 0) {
      const out = tail(`${r.stdout}\n${r.stderr}`);
      await git(root, ['revert', '--abort']);
      if (start && (await gitOut(root, ['rev-parse', 'HEAD'])) !== start) await git(root, ['reset', '--hard', start]); // undo reverts of this same call: the tree was clean when we began
      return { exit: EXIT.GATE, result: { reverted: [], conflict: true, commit: sha.slice(0, 7), output: out }, text: `git revert of ${sha.slice(0, 7)} failed (conflict or hook); aborted, the repository is unchanged.\n${out}`, next_actions: [{ cmd: 'git log --oneline -n 10', why: 'later commits touch the same lines: revert those findings first, or fix the file by hand and re-run the wave gate' }] };
    }
  }

  // trailer on the revert commit (the last one made)
  const { config } = loadConfig(root);
  const ids = memberFindings.map((f) => f.id);
  const warnings = [];
  const msg = ((await gitOut(root, ['log', '-1', '--format=%B', 'HEAD'])) || '').trimEnd();
  const amend = ['commit', '--amend', '-F', '-'];
  if (config.commit?.no_verify === true) amend.push('--no-verify');
  const a = await git(root, amend, { input: `${msg}\n\n${ids.map((i) => `Reverts-Finding: ${i}`).join('\n')}\n`, timeoutMs: 600_000 });
  if (a.code !== 0) warnings.push(`the revert commit was made but the Reverts-Finding trailer could not be added (${tail(`${a.stdout}\n${a.stderr}`, 6)})`);
  const sha = (await gitOut(root, ['rev-parse', '--short', 'HEAD'])) || '';

  const gateRef = [...log].reverse().find((e) => e.ev === 'bisect' && (ids.includes(e.culprit) || (e.culprit_ids || []).some((i) => ids.includes(i))))?.output_ref ?? null;
  for (const f of memberFindings) {
    const front = structuredClone(f.front);
    front.state = 'reverted';
    front.reverted = { commit: sha, reason, gate_ref: gateRef };
    const applied = getSection(f.body, 'Applied');
    writeFinding(f.path, front, setSection(f.body, 'Applied', `${applied}\n- reverted: \`${sha}\` — ${reason}${gateRef ? ` (gate output: ${gateRef})` : ''}`.trim()));
  }
  stampLog(root, runId, { ev: 'revert', ids, reason, sha, reverted: shas.map((s) => s.slice(0, 7)) });
  return {
    result: { reverted: ids, sha, reverted_commits: shas.map((s) => s.slice(0, 7)), reason, gate_ref: gateRef },
    text: `reverted ${shas.map((s) => s.slice(0, 7)).join(', ')} as ${sha}: ${ids.join(', ')} now reverted (${reason})`,
    warnings,
    next_actions: [{ cmd: `ts-opt gate --wave ${finding.front.wave}`, why: 're-run the wave gate; if a later commit depended on the reverted one it may still be red: bisect again' }],
  };
}
