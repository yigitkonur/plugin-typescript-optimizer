// Culprit search over one wave's finding commits (doc 06 §5: "unknown culprit -> ts-opt bisect --wave").
//
// Model: the wave-start tag is green; the wave tip is red; find the FIRST finding commit after which the wave gate is red.
// Each probe is a detached `git checkout -q <sha>` + runGate({quiet:true, record:false}); the original branch tip is restored in a
// finally block no matter what (gate crash, checkout failure, ctrl-c).
//
// Limits (documented, not hidden): reverting the culprit can leave a LATER commit that depended on it red, and the search assumes
// monotonic failure (red stays red). The fix skill therefore re-gates after every revert and bisects again until the gate is green.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDir } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { mkdirp, writeAtomic } from '../core/fs.mjs';
import { run as runProc } from '../core/proc.mjs';
import { getFinding } from './findings.mjs';
import { parseStatusZ } from './commit-policy.mjs';

const git = (root, args, o = {}) => runProc(['git', ...args], { cwd: root, timeoutMs: 120_000, maxBytes: 32 * 1024 * 1024, ...o });
const gitOut = async (root, args) => { const r = await git(root, args); return r.code === 0 ? r.stdout.trim() : null; };

export function readLog(root, runId) {
  const f = join(runDir(root, runId), 'apply', 'log.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** finding commits of one wave in history order: [{sha, ids}] (log events first, Wave:/Finding: trailers as the fallback) */
export async function waveCommits({ root, runId, run, wave }) {
  const w = (run.waves || []).find((x) => String(x.id) === String(wave));
  if (!w) throw new TsOptError(EXIT.NOTHING, `wave ${wave} is not part of run ${runId}`);
  const base = w.tag && (await gitOut(root, ['rev-parse', '--verify', '--quiet', `${w.tag}^{commit}`])) ? w.tag : run.applying?.base;
  if (!base) throw new TsOptError(EXIT.PRECONDITION, `wave ${wave} has no start tag and the run has no base commit`);
  const rl = await git(root, ['rev-list', '--reverse', `${base}..HEAD`]);
  if (rl.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `cannot list commits since ${base}: ${rl.stderr.trim()}`);
  const range = rl.stdout.split('\n').filter(Boolean);
  const inRange = (sha) => range.find((h) => h.startsWith(String(sha)));

  const byFull = new Map();
  const add = (full, ids) => { const cur = byFull.get(full) || []; byFull.set(full, [...new Set([...cur, ...ids])]); };
  const waveOf = new Map();
  for (const e of readLog(root, runId)) {
    if (e.ev !== 'commit' || !e.sha) continue;
    const full = inRange(e.sha);
    if (!full) continue;
    const ids = e.ids || (e.id ? [e.id] : []);
    let ew = e.wave;
    if (ew === undefined) { try { ew = getFinding(root, runId, ids[0]).front.wave; } catch { ew = null; } }
    waveOf.set(full, String(ew));
    if (String(ew) === String(wave)) add(full, ids);
  }
  if (!byFull.size) {
    for (const h of range) {
      const msg = (await gitOut(root, ['log', '-1', '--format=%B', h])) || '';
      const wv = /^Wave:\s*(\S+)\s*$/m.exec(msg)?.[1];
      if (wv !== String(wave)) continue;
      const ids = [...msg.matchAll(/^Finding:\s*(F-\d{4,})\s*$/gm)].map((m) => m[1]);
      if (ids.length) add(h, ids);
    }
  }
  return range.filter((h) => byFull.has(h)).map((sha) => ({ sha, ids: byFull.get(sha) }));
}

async function currentRef(root) {
  const branch = await gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = await gitOut(root, ['rev-parse', 'HEAD']);
  if (!sha) throw new TsOptError(EXIT.PRECONDITION, 'not a git repository with commits');
  return { branch: branch && branch !== 'HEAD' ? branch : null, sha };
}

/**
 * @param {object} a {root, runId, run, wave, runGate (injectable), commits? (injectable)}
 * @returns {Promise<{green:boolean, culprit:string|null, culprit_ids:string[], commit:string|null, probes:number, output_ref:string|null, commits:number, note?:string}>}
 */
export async function bisectWave({ root, runId, run, wave, runGate, commits = null }) {
  const dirty = parseStatusZ((await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout);
  if (dirty.length) throw new TsOptError(EXIT.PRECONDITION, `the working tree has ${dirty.length} uncommitted change(s): ${dirty.slice(0, 6).map((d) => d.path).join(', ')}`, 'bisect checks out old commits; commit or stash first');
  const list = commits || await waveCommits({ root, runId, run, wave });
  if (!list.length) throw new TsOptError(EXIT.NOTHING, `no finding commits found for wave ${wave}`);
  const orig = await currentRef(root);
  let probes = 0;
  let lastRed = null;
  let at = orig.sha;
  const probe = async (sha) => {
    if (sha !== at) {
      const co = await git(root, ['checkout', '-q', sha]);
      if (co.code !== 0) throw new TsOptError(EXIT.PRECONDITION, `cannot check out ${sha.slice(0, 7)}: ${co.stderr.trim()}`);
      at = sha;
    }
    probes++;
    const res = await runGate({ root, runId, wave, quiet: true, record: false });
    if (!res.passed) lastRed = { sha, res };
    return res.passed;
  };
  try {
    // the tip first: nothing to bisect when it is green
    if (await probe(orig.sha)) return { green: true, culprit: null, culprit_ids: [], commit: null, probes, output_ref: null, commits: list.length, note: `wave ${wave} gate is green at the tip; nothing to bisect` };
    const last = list.at(-1);
    let lo = 0; let hi = list.length - 1;
    if (last.sha !== orig.sha && await probe(last.sha)) {
      return { green: false, culprit: null, culprit_ids: [], commit: null, probes, output_ref: refOf(root, runId, wave, lastRed), commits: list.length, note: 'the gate is green at the last finding commit but red at the tip: a later non-finding commit (a revert or an artifacts commit) broke it' };
    }
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await probe(list[mid].sha)) lo = mid + 1; else hi = mid;
    }
    const culprit = list[lo];
    const red = lastRed && lastRed.sha === culprit.sha ? lastRed : null;
    return { green: false, culprit: culprit.ids[0], culprit_ids: culprit.ids, commit: culprit.sha, probes, output_ref: refOf(root, runId, wave, red, culprit.sha), commits: list.length };
  } finally {
    await restore(root, orig);
  }
}

async function restore(root, orig) {
  const target = orig.branch || orig.sha;
  let r = await git(root, ['checkout', '-q', target]);
  if (r.code !== 0) r = await git(root, ['checkout', '-q', '-f', target]); // a gate leg may have left tracked changes behind; the tree was clean when we began
  const now = await gitOut(root, ['rev-parse', 'HEAD']);
  if (r.code !== 0 || now !== orig.sha) throw new TsOptError(EXIT.INTERNAL, `could not restore ${target} (${orig.sha.slice(0, 7)}) after bisect: ${r.stderr.trim()}`, `run: git checkout -f ${target}`);
}

/** keep the red probe's gate result next to the other gate output (gitignored) and return its repo-relative path */
function refOf(root, runId, wave, red, sha = null) {
  const hit = red && (sha === null || red.sha === sha) ? red : null;
  if (!hit) return null;
  const dir = join(runDir(root, runId), 'apply', 'gate');
  mkdirp(dir);
  const name = `bisect-wave-${wave}-${hit.sha.slice(0, 7)}.json`;
  writeAtomic(join(dir, name), JSON.stringify({ wave, commit: hit.sha, result: hit.res }, null, 2) + '\n');
  return `.ts-optimize/runs/${runId}/apply/gate/${name}`;
}
