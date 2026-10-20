// Fingerprints shared by baseline, gate, check and commit (doc 05 §9.1).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run as runProc } from '../core/proc.mjs';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** diagnostic message with paths made repo-relative, positions removed and whitespace collapsed; quoted identifiers/types kept */
export function normaliseMessage(msg, root = '') {
  let m = String(msg || '');
  if (root) m = m.split(root + '/').join('').split(root).join('');
  return m.replace(/\(\d+,\d+\)/g, '').replace(/:\d+:\d+/g, '').replace(/\s+/g, ' ').trim();
}

/** sha1(relative_file | "TS" + code | normalised_message) */
export function diagFingerprint(d, root = '') {
  const code = String(d.code || '').replace(/^TS/, '');
  return sha1(`${String(d.file || '').split('\\').join('/')}|TS${code}|${normaliseMessage(d.message, root)}`);
}

/** multiset: fingerprint -> count */
export function diagMultiset(diags, root = '') {
  const m = {};
  for (const d of diags) { if (d.severity && d.severity !== 'error') continue; const f = diagFingerprint(d, root); m[f] = (m[f] || 0) + 1; }
  return m;
}

/** fingerprints whose count exceeds the baseline count -> [{fingerprint, count, baseline}] */
export function newFingerprints(baseline, current) {
  const out = [];
  for (const [f, n] of Object.entries(current)) if (n > (baseline[f] || 0)) out.push({ fingerprint: f, count: n, baseline: baseline[f] || 0 });
  return out;
}

/** sha1 of the whole multiset, order independent */
export const multisetHash = (m) => 'sha1:' + sha1(Object.keys(m).sort().map((k) => `${k}:${m[k]}`).join('\n'));

/**
 * Worktree fingerprint = sha1(HEAD sha + "\0" + sorted "<path>\0<sha1(content)>" for every path reported by git status, .ts-optimize/ excluded).
 * A fast-check/gate result is valid only for the fingerprint it was computed at. Null outside a git repo.
 */
export async function worktreeFingerprint(root) {
  const head = await runProc(['git', 'rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
  if (head.code !== 0) return null;
  const st = await runProc(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, timeoutMs: 20_000, maxBytes: 32 * 1024 * 1024 });
  if (st.code !== 0) return null;
  const parts = st.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; const x = e[0]; const p = e.slice(3);
    if (x === 'R' || x === 'C') i++;
    if (p === '.ts-optimize' || p.startsWith('.ts-optimize/')) continue;
    paths.push(p);
  }
  paths.sort();
  const rows = paths.map((p) => { let h = 'deleted'; try { h = sha1(readFileSync(join(root, p))); } catch { /* removed or unreadable */ } return `${p}\0${h}`; });
  return 'wt:' + sha1(head.stdout.trim() + '\0' + rows.join('\n'));
}
