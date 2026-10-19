// Gate legs as detected (doc 05 §6, §9). Execution lives in lib/gate/ (later phase); this is the *definition*.
import { dirname, join, resolve } from 'node:path';
import { toPosix } from '../core/fs.mjs';
import { topoOrder } from './packages.mjs';

const RUNNERS = [[/\bvitest\b/, 'vitest'], [/\bjest\b/, 'jest'], [/\bmocha\b/, 'mocha'], [/\bnode\s+--test\b/, 'node-test'], [/\bplaywright\s+test\b/, 'playwright'], [/\bbun\s+test\b/, 'bun-test'], [/\bdeno\s+test\b/, 'deno-test']];
export const runnerOf = (script) => (RUNNERS.find(([re]) => re.test(script || '')) || [null, null])[1];

function coveredConfigs(root, packages) {
  const covered = new Set();
  const visit = (absCfgDir, cfgFile, ownerPkg) => {
    for (const r of cfgFile.references || []) {
      const p = resolve(absCfgDir, r);
      covered.add(p); covered.add(p + '.json'); covered.add(join(p, 'tsconfig.json'));
    }
  };
  for (const p of packages) for (const c of p.tsconfigs) if (c.class === 'solution') visit(join(root, p.path === '.' ? '' : p.path, dirname(c.file)), c, p);
  return covered;
}

export function buildGate({ root, pm, packages, rootPkg, pmFor = () => pm }) {
  const legs = []; const unavailable = [];
  const real = packages.filter((p) => !p.root_only);
  const covered = coveredConfigs(root, packages);
  const solutionOwners = new Set(packages.filter((p) => p.tsconfigs.some((c) => c.class === 'solution')).map((p) => p.path));

  for (const p of real) {
    for (const e of p.typecheck_set) {
      const abs = e.config ? resolve(root, p.path === '.' ? '' : p.path, e.config) : null;
      if (abs && covered.has(abs) && !solutionOwners.has(p.path)) continue; // typechecked via a solution config elsewhere
      legs.push({ id: 'typecheck', cwd: p.path, ...(e.variant === 'script' && p.kind !== 'deno' && pmFor(p).run ? { argv: [...pmFor(p).run, e.script] } : {}), ...e });
    }
  }
  if (!legs.some((l) => l.id === 'typecheck')) unavailable.push({ id: 'typecheck', reason: real.length ? 'no tsconfig or typecheck script found' : 'no TypeScript package' });

  const scriptLegs = (id) => {
    const rootScript = rootPkg?.scripts?.[id];
    if (rootScript && pm.run) return [{ id, cwd: '.', script: id, argv: [...pm.run, id], runner: runnerOf(rootScript) }];
    return topoOrder(real).filter((p) => p.scripts[id] && pmFor(p).run).map((p) => ({ id, cwd: p.path, script: id, argv: [...pmFor(p).run, id], runner: runnerOf(p.scripts[id]) }));
  };
  for (const id of ['test', 'build']) {
    const ls = scriptLegs(id);
    if (ls.length) legs.push(...ls);
    else unavailable.push({ id, reason: real.some((p) => pmFor(p).run) || pm.run ? `no "${id}" script in the root or any TypeScript package` : 'no package manager detected' });
  }
  for (const p of real) {
    if (p.declaration_signal && !p.tsconfigs.some((c) => c.class === 'solution')) {
      const cfg = p.tsconfigs.find((c) => c.file === 'tsconfig.json') || p.tsconfigs.find((c) => c.class === 'project');
      if (cfg) legs.push({ id: 'declaration-emit', cwd: p.path, config: cfg.file });
    }
  }
  return { legs, unavailable };
}
export { toPosix };
