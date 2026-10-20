// ts-opt bisect --wave <id>: name the first finding commit after which the wave gate is red (doc 02 §3.2, doc 06 §5).
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { findRoot } from '../detect/root.mjs';
import { bisectWave } from '../gate/bisect.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { gitOut, loadGate } from './commit.mjs';

export const spec = { wave: 'string' };

export async function run({ cwd, flags }, opts = {}) {
  if (!flags.wave) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt bisect --wave <id>');
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  return withRunLock(root, runId, 'bisect', async () => {
    const run0 = readRun(root, runId);
    if (!['applying', 'verifying'].includes(run0.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${run0.state}; bisect works while a run is applying or verifying`);
    if (run0.applying?.branch) {
      const branch = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (branch !== run0.applying.branch) throw new TsOptError(EXIT.PRECONDITION, `on branch ${branch}, but run ${runId} applies on ${run0.applying.branch}`, `git switch ${run0.applying.branch}`);
    }
    const runGate = opts.runGate || (await loadGate('gate', 'runGate'));
    const wave = String(flags.wave);
    const r = await bisectWave({ root, runId, run: run0, wave, runGate, commits: opts.commits || null });
    if (r.green) return { result: { wave, ...r }, text: r.note };
    if (r.culprit) stampLog(root, runId, { ev: 'bisect', wave, culprit: r.culprit, commit: r.commit.slice(0, 7), culprit_ids: r.culprit_ids, probes: r.probes, output_ref: r.output_ref });
    return {
      result: { wave, ...r },
      text: r.culprit
        ? `wave ${wave}: first red commit is ${r.commit.slice(0, 7)} (${r.culprit_ids.join(', ')}) after ${r.probes} gate probe(s) over ${r.commits} commit(s)${r.output_ref ? `\ngate output: ${r.output_ref}` : ''}`
        : `wave ${wave}: ${r.note}`,
      next_actions: r.culprit ? [{ cmd: `ts-opt revert ${r.culprit} --reason "wave ${wave} gate red after this commit (bisect)"`, why: 'revert the culprit, then re-run `ts-opt gate --wave ' + wave + '`; if it is still red, bisect again (a later commit may have depended on it)' }] : [],
    };
  });
}
