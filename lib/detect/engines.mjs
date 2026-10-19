// Engine resolution + smoke probes (doc 05 §7): project-local -> toolbox -> PATH -> absent.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { run, IS_WIN } from '../core/proc.mjs';
import { readJsonc } from '../core/fs.mjs';
import { findBin, findPackage, whichSync } from './compilers.mjs';

const exe = (n) => (IS_WIN ? n + '.cmd' : n);
// name -> { bins, pkg (npm package that owns the bin), versionArgs }
export const ENGINE_DEFS = {
  knip: { bins: ['knip'], pkg: 'knip' },
  biome: { bins: ['biome'], pkg: '@biomejs/biome' },
  oxlint: { bins: ['oxlint'], pkg: 'oxlint' },
  eslint: { bins: ['eslint'], pkg: 'eslint' },
  ultracite: { bins: ['ultracite'], pkg: 'ultracite' },
  'type-coverage': { bins: ['type-coverage'], pkg: 'type-coverage' },
  'ast-grep': { bins: ['ast-grep', 'sg'], pkg: '@ast-grep/cli' },
  madge: { bins: ['madge'], pkg: 'madge' },
  dpdm: { bins: ['dpdm'], pkg: 'dpdm' },
  rg: { bins: ['rg'], pkg: null },
};

function parseVersion(out) {
  const m = /(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)/.exec(out || '');
  return m ? m[1] : null;
}

async function probeOne(name, def, { root, pkgDirs, toolboxBin }) {
  let bin = null; let source = null; let version = null;
  if (def.pkg) {
    for (const d of [root, ...pkgDirs]) {
      for (const b of def.bins) {
        const p = findBin(d, root, b);
        if (p) { bin = p; source = 'project'; version = findPackage(d, root, def.pkg)?.version || null; break; }
      }
      if (bin) break;
    }
    if (!bin && toolboxBin) for (const b of def.bins) { const p = join(toolboxBin, exe(b)); if (existsSync(p)) { bin = p; source = 'toolbox'; break; } }
  }
  if (!bin) for (const b of def.bins) { const p = whichSync(b); if (p) { bin = p; source = 'path'; break; } }
  if (!bin) return { version: null, source: null, works: false, reason: 'absent', bin: null };
  const r = await run([bin, '--version'], { timeoutMs: 5000, cwd: root });
  const works = r.code === 0 && !r.timedOut && !/\bat .*\(.*:\d+:\d+\)/.test(r.stderr);
  if (!version) version = parseVersion(r.stdout) || parseVersion(r.stderr);
  return { version, source, works, reason: works ? null : r.timedOut ? 'smoke test timed out (5 s)' : `exit ${r.code}: ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 160) || 'no output'}`, bin };
}

export async function probeEngines(ctx) {
  const names = Object.keys(ENGINE_DEFS);
  const results = await Promise.all(names.map((n) => probeOne(n, ENGINE_DEFS[n], ctx)));
  return Object.fromEntries(names.map((n, i) => [n, results[i]]));
}

/** lint engine priority: Ultracite > Biome > Oxlint > ESLint flat > ESLint legacy (doc 05 §7) */
export function detectLint(root, manifests, depNames, engines) {
  const all = new Set(manifests.all);
  const dep = (n) => depNames.has(n);
  const has = (re) => manifests.all.some((f) => !f.includes('/') && re.test(f));
  const pick = (engine, config, argv) => ({ engine, config, autofix: engines[engine]?.bin ? [engines[engine].bin, ...argv] : null, usable: !!engines[engine]?.works });
  if (dep('ultracite')) return pick('ultracite', 'biome.json', ['fix']);
  if (dep('@biomejs/biome') || all.has('biome.json') || all.has('biome.jsonc')) return pick('biome', all.has('biome.jsonc') ? 'biome.jsonc' : 'biome.json', ['check', '--write']);
  if (dep('oxlint') || all.has('.oxlintrc.json')) return pick('oxlint', '.oxlintrc.json', ['--fix']);
  if (has(/^eslint\.config\.(c|m)?(j|t)s$/)) return { ...pick('eslint', 'eslint.config.*', ['--fix']), flat: true };
  if (dep('eslint') || has(/^\.eslintrc/)) return { ...pick('eslint', '.eslintrc*', ['--fix']), flat: false };
  return { engine: null, config: null, autofix: null, usable: false };
}
export { readJsonc };
