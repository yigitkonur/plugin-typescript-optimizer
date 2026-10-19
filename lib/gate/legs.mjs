// Gate leg definitions as recorded in run.json (doc 04 §4.1, doc 05 §9). Execution is lib/gate/run.mjs (fix phase).
import { relative } from 'node:path';
import { toPosix } from '../core/fs.mjs';

const relBin = (root, p) => (p && p.startsWith(root) ? toPosix(relative(root, p)) : p);

/** detect() gate leg -> {id, cmd[], cwd, timeout_s, variant, ...} */
export function resolveLegs(d, config) {
  const root = d.root;
  const timeouts = config.gate?.timeout_s || {};
  const out = [];
  for (const l of d.gate.legs) {
    const pkg = d.packages.find((p) => p.path === l.cwd);
    const comp = pkg?.compilers?.authoritative;
    const tsc = comp?.bin ? relBin(root, comp.bin) : comp?.exec ? null : null;
    const base = { id: l.id, cwd: l.cwd, timeout_s: timeouts[l.id === 'declaration-emit' ? 'typecheck' : l.id] || 600 };
    if (l.id === 'typecheck') {
      if (l.variant === 'script' && l.argv) out.push({ ...base, cmd: l.argv, variant: 'script', checker: l.checker });
      else if (l.variant === 'deno') out.push({ ...base, cmd: l.argv, variant: 'deno' });
      else if (tsc) out.push({ ...base, cmd: l.variant === 'tsc-b' ? [tsc, '-b', l.config, '--noEmit', '--pretty', 'false'] : [tsc, '--noEmit', '--pretty', 'false', '-p', l.config], variant: l.variant === 'tsc-b' ? 'noemit-b' : 'noemit' });
      else if (comp?.exec) out.push({ ...base, cmd: [...comp.exec, ...(l.variant === 'tsc-b' ? ['-b', l.config, '--noEmit'] : ['--noEmit', '-p', l.config]), '--pretty', 'false'], variant: l.variant === 'tsc-b' ? 'noemit-b' : 'noemit' });
    } else if (l.id === 'declaration-emit') {
      if (tsc) out.push({ ...base, cmd: [tsc, '-p', l.config, '--declaration', '--emitDeclarationOnly', '--noEmit', 'false', '--outDir', '<tmp>', '--tsBuildInfoFile', '<tmp>/x.tsbuildinfo', '--pretty', 'false'], variant: 'temp-outdir' });
    } else if (l.argv) out.push({ ...base, cmd: l.argv, ci_env: { CI: '1' }, runner: l.runner ?? null });
  }
  return out;
}
