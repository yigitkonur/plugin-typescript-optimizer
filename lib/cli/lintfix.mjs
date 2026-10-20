// ts-opt lint-fix <F-id>: run the project's own lint engine autofix (resolved by detect) on the finding's files (wave R0 and the bridge B).
// The edit is made by the user's tool under the user's config, never by plugin code (doc 02 §3.3). Commit the result with `ts-opt commit`.
import { join } from 'node:path';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile } from '../core/fs.mjs';
import { safeRel } from '../core/pathsafe.mjs';
import { run as runProc } from '../core/proc.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { git } from './commit.mjs';

export const spec = {};
const WAVES = new Set(['R0', 'B']);

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '')) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt lint-fix F-0007');
  return withRunLock(root, runId, 'lint-fix', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; lint-fix edits files, so it only works while applying`, 'start the wave first: `ts-opt run wave begin <id>`');
    const f = getFinding(root, runId, fid);
    if (!WAVES.has(String(f.front.wave))) throw new TsOptError(EXIT.PRECONDITION, `${fid} is in wave ${f.front.wave}; the lint autofix belongs to waves R0 and B only`);
    if (f.front.state !== 'approved') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}, not approved`);
    const d = await detectProject(root);
    const lint = d.lint;
    if (!lint?.usable || !lint.autofix) throw new TsOptError(EXIT.CAPABILITY, `no usable lint engine (${lint?.engine ? lint.engine + ' did not run' : 'none detected'}); make the edits listed in the finding by hand, inside its touches`, 'this is the assisted path: fix_mode is assisted for this finding');
    const files = [];
    for (const t of f.front.touches || []) {
      const rel = safeRel(root, t); // a touch that is a symlink to (or below a link to) somewhere outside the repository is never handed to a tool that writes
      if (!rel) throw new TsOptError(EXIT.GUARD, `${t} resolves outside the repository; ${fid} cannot be fixed by the lint engine`, 'remove the link or skip the finding with `ts-opt findings skip`');
      if (isFile(join(root, rel))) files.push(rel);
    }
    if (!files.length) throw new TsOptError(EXIT.NOTHING, `none of ${fid}'s touches exist`);
    // formatter and import sorting are not part of this wave: biome's `check --write` would reformat whole files, `lint --write` fixes lint rules only
    const base = lint.engine === 'biome' ? [lint.autofix[0], 'lint', '--write'] : lint.autofix;
    const argv = [...base, '--', ...files];
    const res = await runProc(argv, { cwd: root, timeoutMs: 300_000, env: { CI: '1' }, maxBytes: 4 * 1024 * 1024 });
    const stat = (await git(root, ['diff', '--stat', '--', ...files])).stdout.trim();
    stampLog(root, runId, { ev: 'lint-fix', id: fid, engine: lint.engine, exit: res.code, files: files.length, changed: !!stat });
    if (res.timedOut) throw new TsOptError(EXIT.GATE, `${lint.engine} autofix timed out after 300 s`);
    const tail = `${res.stdout}\n${res.stderr}`.trim().split('\n').slice(-12).join('\n');
    return {
      result: { id: fid, engine: lint.engine, exit: res.code, changed: !!stat, stat, files },
      text: `${lint.engine} autofix on ${files.length} file(s), exit ${res.code}${stat ? `\n${stat}` : '\nno file changed'}\n${tail}`,
      next_actions: stat ? [{ cmd: `ts-opt check`, why: 'then `ts-opt commit ' + fid + '`' }] : [{ cmd: `ts-opt findings show ${fid}`, why: 'the engine fixed nothing; finish the residue by hand inside touches' }],
    };
  });
}
