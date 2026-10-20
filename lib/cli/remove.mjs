// ts-opt remove <F-id>: delete the file of a reach-01 finding with `git rm` (the fix skill has no shell `rm`; a deletion is mechanical,
// so the CLI does it instead of a free-form command). Commit the result with `ts-opt commit`. Routed-looking files: `ts-opt quarantine`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { git } from './commit.mjs';

export const spec = {};

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '')) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt remove F-0007');
  return withRunLock(root, runId, 'remove', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; remove deletes files, so it only works while applying`, 'start the wave first: `ts-opt run wave begin <id>`');
    const f = getFinding(root, runId, fid);
    if (f.front.rule !== 'reach-01') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.rule}; only reach-01 (unreferenced file) findings are deleted by the CLI`);
    if (f.front.state !== 'approved') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}, not approved`);
    if (f.front.fix_risk === 'high') throw new TsOptError(EXIT.PRECONDITION, `${fid} is high risk (route-like or framework-owned path); use \`ts-opt quarantine ${fid}\` unless the plan records an explicit delete decision`, 'a green gate proves static death only');
    const rel = f.front.location.file;
    if (!rel || rel.startsWith('.quarantine/') || rel.startsWith('/') || rel.split('/').includes('..')) throw new TsOptError(EXIT.USAGE, `unsafe path ${rel}`);
    if (!existsSync(join(root, rel))) throw new TsOptError(EXIT.NOTHING, `${rel} does not exist (already removed?)`);
    const rm = await git(root, ['rm', '-q', '--', rel]);
    if (rm.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `git rm ${rel} failed: ${rm.stderr.trim().slice(0, 300)}`);
    stampLog(root, runId, { ev: 'remove', id: fid, file: rel });
    return { result: { id: fid, removed: [rel] }, text: `removed ${rel} (staged by git rm)\nnext: ts-opt check, then ts-opt commit ${fid}`, next_actions: [{ cmd: 'ts-opt check', why: `then \`ts-opt commit ${fid}\`` }] };
  });
}
