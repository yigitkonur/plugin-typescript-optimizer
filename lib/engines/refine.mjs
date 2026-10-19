// Post-engine refinements: cheap structural checks that regex tells cannot make (kept out of the tells so they stay data-driven).
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { isBarrelText } from './knip.mjs';

/** struct-01 tell t2 ("sibling imports through its own directory barrel"): keep only when the target index file really is a barrel. */
export async function refineCandidates(cands, { root, allFiles }) {
  const set = new Set(allFiles);
  const out = [];
  for (const c of cands) {
    if (c.rule === 'struct-01' && (c.tells || []).includes('t2') && !(c.tells || []).includes('t1')) {
      const m = /from\s*['"](\.{1,2}(?:\/index(?:\.[cm]?[jt]sx?)?)?|\.\/?)['"]/.exec(c.snippet || '') || /['"](\.{1,2}\/index(?:\.[cm]?[jt]sx?)?)['"]/.exec(c.snippet || '');
      if (m) {
        const base = posix.normalize(posix.join(posix.dirname(c.file), m[1] === '.' ? './' : m[1]));
        const target = [base, ...['.ts', '.tsx', '.mts', '.js', '.jsx'].map((e) => base.replace(/\/$/, '') + '/index' + e), base.replace(/\/$/, '') + '.ts'].find((f) => set.has(f) && /(^|\/)index\.[cm]?[jt]sx?$/.test(f));
        if (target) {
          let text = ''; try { text = await readFile(join(root, target), 'utf8'); } catch { /* unreadable */ }
          if (!isBarrelText(text)) continue; // a real module named index.ts is not a barrel
        }
      }
    }
    out.push(c);
  }
  return out;
}
