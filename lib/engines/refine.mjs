// Post-engine refinements: cheap structural checks that regex tells cannot make (kept out of the tells so they stay data-driven).
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { isBarrelText } from './knip.mjs';
import { routeLike } from '../detect/packs.mjs';
import { isTestPath } from '../detect/classify.mjs';

const VIRTUAL_SCHEMES = new Set(['cloudflare', 'node', 'bun', 'deno', 'astro', 'virtual', 'npm', 'jsr', 'nuxt', 'data', 'file', 'http', 'https']);

/** struct-01 tell t2 ("sibling imports through its own directory barrel"): keep only when the target index file really is a barrel. */
export async function refineCandidates(cands, { root, allFiles, detect = null, rules = new Map() }) {
  const set = new Set(allFiles);
  const out = [];
  for (const c of cands) {
    // scheme-qualified specifiers (cloudflare:workers, node:fs, bun:test, astro:content, virtual:…) are runtime/bundler modules, never packages
    if (c.rule === 'reach-08' && /unlisted|unresolved/.test(c.engine) && c.symbol && new RegExp(`['"\`]${c.symbol.replace(/[^\w-]/g, '')}:[^'"\`]+['"\`]`).test(c.snippet || '') && VIRTUAL_SCHEMES.has(c.symbol)) continue;
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
    // runtime-pack gated rules (plat-*): only inside a workerd variant; severity follows that variant's process_env_populated
    const req = rules.get(c.rule)?.requires?.pack;
    if (req === 'workerd') {
      const wk = detect?.packs?.find((p) => p.name === 'workerd');
      const variant = wk?.variants?.filter((v) => v.dir === '.' || v.dir === '' || c.file === v.dir || c.file.startsWith(v.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
      if (!variant) continue;
      if (c.rule === 'plat-01') {
        const st = variant.process_env_populated;
        const dg = rules.get(c.rule)?.downgrade_in || {};
        c.severity_hint = st === true ? dg.process_env_populated_true || 'advisory' : st === 'unknown' ? dg.process_env_populated_unknown || 'warn' : rules.get(c.rule).severity;
        c.context = { pack: 'workerd', variant: variant.dir, process_env_populated: st, reason: variant.populated_reason };
      } else c.context = { pack: 'workerd', variant: variant.dir };
    }
    // reach-01 fix risk by path class (doc 06 §2.2): route-like -> high, test/story/fixture -> low, else medium
    if (c.rule === 'reach-01') {
      const fws = detect?.frameworks || [];
      if (routeLike(c.file, fws)) { c.fix_risk_hint = 'high'; c.context = { ...(c.context || {}), route_like: true }; }
      else if (isTestPath(c.file)) c.fix_risk_hint = 'low';
      else c.fix_risk_hint = 'medium';
    }
    out.push(c);
  }
  return out;
}
