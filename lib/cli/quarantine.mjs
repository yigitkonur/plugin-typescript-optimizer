// ts-opt quarantine <F-id>: move the file(s) of a reach-01 finding to .quarantine/<path> with `git mv` instead of deleting them
// (doc 06 reach-01: a green gate proves static death, never runtime death of a routed file). Commit the move with `ts-opt commit`.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { safeRel } from '../core/pathsafe.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { withRunLock } from '../gate/lock.mjs';
import { git } from './commit.mjs';

export const spec = {};

export async function run({ cwd, flags, args }) {
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  const fid = args[0];
  if (!/^F-\d{4,}$/.test(fid || '')) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt quarantine F-0007');
  return withRunLock(root, runId, 'quarantine', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; quarantine moves files, so it only works while applying`, 'start the wave first: `ts-opt run wave begin 1`');
    const f = getFinding(root, runId, fid);
    if (f.front.rule !== 'reach-01') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.rule}; only reach-01 (unreferenced file) findings are quarantined`);
    if (f.front.state !== 'approved') throw new TsOptError(EXIT.PRECONDITION, `${fid} is ${f.front.state}, not approved`);
    const files = [f.front.location.file];
    const moved = [];
    for (const rel of files) {
      if (rel.startsWith('.quarantine/') || rel.split('/').includes('..') || rel.startsWith('/') || safeRel(root, rel) !== rel || safeRel(root, '.quarantine/' + rel) !== '.quarantine/' + rel) throw new TsOptError(EXIT.USAGE, `unsafe path ${rel}`);
      if (!existsSync(join(root, rel))) throw new TsOptError(EXIT.NOTHING, `${rel} does not exist (already moved?)`);
      const dest = `.quarantine/${rel}`;
      mkdirSync(dirname(join(root, dest)), { recursive: true });
      const m = await git(root, ['mv', '--', rel, dest]);
      if (m.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `git mv ${rel} failed: ${m.stderr.trim().slice(0, 300)}`);
      moved.push({ from: rel, to: dest });
    }
    stampLog(root, runId, { ev: 'quarantine', id: fid, files: moved });
    return {
      result: { id: fid, moved },
      text: `quarantined ${moved.map((m) => `${m.from} -> ${m.to}`).join(', ')} (staged by git mv)\nnext: ts-opt commit ${fid}`,
      next_actions: [{ cmd: `ts-opt commit ${fid}`, why: 'record the move; .quarantine/README.md is written at `ts-opt run finish`' }],
    };
  });
}
