// ts-opt move <F-id> --from <path> --to <path>: `git mv` a file the finding is about (struct-06 relocation, struct-07 canonical module,
// struct-08 pods) so history follows (doc 06 §6: "use git mv"). Both paths must be inside the repository and the source in the finding's touches.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { safeRel } from '../core/pathsafe.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { git } from './commit.mjs';

export const spec = { from: 'string', to: 'string' };
const safe = (rel) => rel && !rel.startsWith('/') && !rel.split('/').includes('..') && !rel.startsWith('.ts-optimize/') && !rel.startsWith('.git/') && !rel.startsWith('node_modules/');

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '') || !flags.from || !flags.to) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt move F-0007 --from src/utils/x.ts --to src/feature/x.ts');
  return withRunLock(root, runId, 'move', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; move changes files, so it only works while applying`);
    const f = getFinding(root, runId, fid);
    if (f.front.state !== 'approved') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}, not approved`);
    if (!safe(flags.from) || !safe(flags.to) || safeRel(root, flags.from) !== flags.from || safeRel(root, flags.to) !== flags.to) throw new TsOptError(EXIT.USAGE, 'unsafe path (outside the repository, or through a symbolic link)');
    if (!f.front.touches.includes(flags.from) || !f.front.touches.includes(flags.to)) throw new TsOptError(EXIT.PRECONDITION, `both paths must be in ${fid}'s touches (${f.front.touches.join(', ')}): the destination is part of the plan, not a surprise`);
    if (!existsSync(join(root, flags.from))) throw new TsOptError(EXIT.NOTHING, `${flags.from} does not exist`);
    if (existsSync(join(root, flags.to))) throw new TsOptError(EXIT.PRECONDITION, `${flags.to} already exists`);
    mkdirSync(dirname(join(root, flags.to)), { recursive: true });
    const m = await git(root, ['mv', '--', flags.from, flags.to]);
    if (m.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `git mv failed: ${m.stderr.trim().slice(0, 300)}`);
    stampLog(root, runId, { ev: 'move', id: fid, from: flags.from, to: flags.to });
    return { result: { id: fid, moved: { from: flags.from, to: flags.to } }, text: `moved ${flags.from} -> ${flags.to} (staged by git mv)\nnext: update the importers inside touches, ts-opt check, ts-opt commit ${fid}` };
  });
}
