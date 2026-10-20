// .ts-optimize/ layout: run directories, run.json, open-run marker (doc 04 §2, §4).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStamp, nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isDir, isFile, mkdirp, readJsonc, writeAtomic } from '../core/fs.mjs';
import { firstSymlinkUnder, insideRoot, isSymlink } from '../core/pathsafe.mjs';

export const ART = '.ts-optimize';
export const OPEN_STATES = new Set(['planned', 'ready', 'locked', 'applying', 'verifying']);
const GITIGNORE = 'state/\n.cache/\nfit/\nruns/*/raw/\nruns/*/apply/gate/\n';
const README = `# .ts-optimize

Created by the ts-optimize Claude Code plugin (/ts-optimize:audit, :fix, :tsgo).

- runs/<id>/SUMMARY.md and plan.md are the review surface; findings/ has one file per finding.
- suppressions.json, baseline.json and config.json are meant to be committed; state/, .cache/ and runs/*/raw/ are ignored.
- Safe to delete: nothing outside this folder depends on it. Remove it with: rm -rf .ts-optimize
`;

export const artDir = (root) => join(root, ART);
export const runDir = (root, id) => join(root, ART, 'runs', id);

/** the artifact tree is plain directories and files, inside the repository: a symlinked .ts-optimize (or any link below it) would redirect our writes */
export function assertSafeArtifactTree(root) {
  const d = artDir(root);
  if (!existsSync(d) && !isSymlink(d)) return;
  if (isSymlink(d) || !insideRoot(root, d)) throw new TsOptError(EXIT.ARTIFACT, `${ART} is a symbolic link or resolves outside the repository`, `remove it (rm ${ART}) and run the command again`);
  const link = firstSymlinkUnder(d);
  if (link) throw new TsOptError(EXIT.ARTIFACT, `${ART} contains a symbolic link (${link.slice(root.length + 1)}); artifacts are never written through links`, `remove the link and run the command again`);
}

export function ensureArtifactRoot(root) {
  const d = artDir(root);
  assertSafeArtifactTree(root);
  try {
    mkdirp(d);
    const gi = join(d, '.gitignore');
    if (!isFile(gi)) writeFileSync(gi, GITIGNORE);
    const rd = join(d, 'README.md');
    if (!isFile(rd)) writeFileSync(rd, README);
  } catch (e) {
    throw new TsOptError(EXIT.CAPABILITY, `cannot write ${d}: ${e.message}`, 'make the directory writable or run from a writable checkout');
  }
  return d;
}

export function newRunId(root) {
  const stamp = runStamp();
  const suffix = process.env.TS_OPT_RUN_SUFFIX || createHash('sha1').update(`${stamp}${process.pid}${Math.random()}`).digest('hex').slice(0, 4);
  let id = `${stamp}-${suffix}`;
  while (existsSync(runDir(root, id))) id = `${stamp}-${createHash('sha1').update(id + Math.random()).digest('hex').slice(0, 4)}`;
  return id;
}

export function listRuns(root) {
  const d = join(artDir(root), 'runs');
  if (!isDir(d)) return [];
  return readdirSync(d).filter((n) => isFile(join(d, n, 'run.json'))).sort();
}

export function readRun(root, id) {
  const r = readJsonc(join(runDir(root, id), 'run.json'));
  if (!r.ok) throw new TsOptError(EXIT.ARTIFACT, `run ${id}: run.json unreadable (${r.error})`, 'run `ts-opt validate`');
  return r.value;
}
export function writeRun(root, run) {
  writeAtomic(join(runDir(root, run.id), 'run.json'), JSON.stringify(run, null, 2) + '\n');
}

export function openRunId(root) {
  const f = join(artDir(root), 'state', 'open-run');
  if (!isFile(f)) return null;
  const id = readFileSync(f, 'utf8').trim();
  return id || null;
}
export function setOpenRun(root, id) { writeAtomic(join(artDir(root), 'state', 'open-run'), id + '\n'); }
export function clearOpenRun(root) { rmSync(join(artDir(root), 'state', 'open-run'), { force: true }); }

/** --run flag: id | latest | open | undefined (open run, else latest) */
export function resolveRunId(root, flag) {
  if (flag && flag !== 'latest' && flag !== 'open') {
    if (!isFile(join(runDir(root, flag), 'run.json'))) throw new TsOptError(EXIT.NOTHING, `no run ${flag}`);
    return flag;
  }
  const open = openRunId(root);
  if (flag === 'open') { if (!open) throw new TsOptError(EXIT.NOTHING, 'no open run'); return open; }
  if (!flag && open) return open;
  const all = listRuns(root);
  if (!all.length) throw new TsOptError(EXIT.NOTHING, 'no runs yet — run /ts-optimize:audit first');
  return all[all.length - 1];
}

export function stampLog(root, id, event) {
  const f = join(runDir(root, id), 'apply', 'log.jsonl');
  mkdirp(join(runDir(root, id), 'apply'));
  writeFileSync(f, JSON.stringify({ t: nowIso(), ...event }) + '\n', { flag: 'a' });
}
