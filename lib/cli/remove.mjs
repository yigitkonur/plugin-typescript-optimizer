// ts-opt remove <F-id> [--file <path>]: delete a file the finding is about with `git rm` (the fix skill has no shell `rm`/`git`;
// a deletion is mechanical, so the CLI does it instead of a free-form command). Commit the result with `ts-opt commit`.
// reach-01 deletes its own file; any other rule (inlined wrapper, consolidated duplicate) names the file with --file and it must be in the finding's touches.
// Routed-looking files: `ts-opt quarantine`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { safeRel } from '../core/pathsafe.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { git } from './commit.mjs';

export const spec = { file: 'string' };
const safe = (rel) => rel && !rel.startsWith('.quarantine/') && !rel.startsWith('/') && !rel.split('/').includes('..') && !rel.startsWith('.ts-optimize/') && !rel.startsWith('.git/');

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '')) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt remove F-0007 [--file <path in the finding\'s touches>]');
  return withRunLock(root, runId, 'remove', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; remove deletes files, so it only works while applying`, 'start the wave first: `ts-opt run wave begin <id>`');
    const f = getFinding(root, runId, fid);
    if (f.front.state !== 'approved') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}, not approved`);
    const isUnref = f.front.rule === 'reach-01';
    if (isUnref && f.front.fix_risk === 'high' && !flags.file) throw new TsOptError(EXIT.PRECONDITION, `${fid} is high risk (route-like or framework-owned path); use \`ts-opt quarantine ${fid}\` unless the plan records an explicit delete decision`, 'a green gate proves static death only');
    const rel = flags.file || (isUnref ? f.front.location.file : null);
    if (!rel) throw new TsOptError(EXIT.USAGE, `${f.front.rule} deletes a file other than its own anchor: name it with --file (one of ${f.front.touches.join(', ')})`);
    if (!safe(rel) || safeRel(root, rel) !== rel) throw new TsOptError(EXIT.USAGE, `unsafe path ${rel}`);
    if (!f.front.touches.includes(rel)) throw new TsOptError(EXIT.PRECONDITION, `${rel} is not in ${fid}'s touches (${f.front.touches.join(', ')}); record it with \`ts-opt proposal add --origin fixer\` and get it approved first`);
    if (!existsSync(join(root, rel))) throw new TsOptError(EXIT.NOTHING, `${rel} does not exist (already removed?)`);
    const rm = await git(root, ['rm', '-q', '--', rel]);
    if (rm.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `git rm ${rel} failed: ${rm.stderr.trim().slice(0, 300)}`);
    stampLog(root, runId, { ev: 'remove', id: fid, file: rel });
    return { result: { id: fid, removed: [rel] }, text: `removed ${rel} (staged by git rm)\nnext: ts-opt check, then ts-opt commit ${fid}`, next_actions: [{ cmd: 'ts-opt check', why: `then \`ts-opt commit ${fid}\`` }] };
  });
}
