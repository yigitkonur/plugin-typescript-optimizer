// ts-opt pm install: refresh node_modules and the lockfile with the repository's own package manager after a manifest edit
// (waves 5 and T1-T4). The fix skill has no free-form shell, so this is the one way a dependency change reaches the lockfile.
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { statusPaths } from '../core/git.mjs';
import { run as runProc } from '../core/proc.mjs';
import { detect as detectProject } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { withRunLock } from '../gate/lock.mjs';

export const spec = {};
const WAVES = new Set(['5', 'T1', 'T2', 'T3', 'T4']);
const TAIL = 3000;

/** install argv per package manager; lifecycle scripts never run here (a changed dependency set must not execute new code unreviewed) */
export function installArgv(pm) {
  switch (pm.name) {
    case 'npm': return ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'];
    case 'pnpm': return ['pnpm', 'install', '--ignore-scripts'];
    // Yarn Berry turns on immutable installs when CI is set (every child of ts-opt runs with CI=1): this install must update the lockfile
    case 'yarn': return pm.pnp || Number(String(pm.version || '0').split('.')[0]) >= 2 ? ['yarn', 'install', '--mode=skip-build', '--no-immutable'] : ['yarn', 'install', '--ignore-scripts'];
    case 'bun': return ['bun', 'install', '--ignore-scripts'];
    default: return null;
  }
}

export async function run({ cwd, flags, args }) {
  if (args[0] !== 'install') throw new TsOptError(EXIT.USAGE, 'usage: ts-opt pm install');
  const { root } = await findRoot(cwd);
  const runId = resolveRunId(root, flags.run);
  return withRunLock(root, runId, 'pm install', async () => {
    const r = readRun(root, runId);
    if (r.state !== 'applying') throw new TsOptError(EXIT.PRECONDITION, `run ${runId} is ${r.state}; installs happen while applying`, 'start the wave first: `ts-opt run wave begin <id>`');
    const wave = String(r.applying?.wave ?? '');
    if (!WAVES.has(wave)) throw new TsOptError(EXIT.PRECONDITION, `wave ${wave || '-'} does not change dependencies; installs belong to waves 5 and T1-T4`);
    const d = await detectProject(root);
    const argv = installArgv(d.pm);
    if (!argv) throw new TsOptError(EXIT.CAPABILITY, `no installer for package manager "${d.pm.name}"`, 'install by hand, then continue');
    const before = ((await statusPaths(root)) || []).map((e) => e.path).filter((p) => !p.startsWith('.ts-optimize/'));
    const res = await runProc(argv, { cwd: root, timeoutMs: 600_000, env: { CI: '1' }, maxBytes: 8 * 1024 * 1024 });
    const tail = `${res.stdout}\n${res.stderr}`.trim().split('\n').slice(-25).join('\n').slice(-TAIL);
    const after = ((await statusPaths(root)) || []).map((e) => e.path).filter((p) => !p.startsWith('.ts-optimize/'));
    const changed = after.filter((p) => !before.includes(p));
    stampLog(root, runId, { ev: 'pm-install', wave, pm: d.pm.name, exit: res.code, changed });
    if (res.timedOut || res.code !== 0) {
      return { exit: EXIT.GATE, result: { pm: d.pm.name, argv, exit: res.code, timed_out: !!res.timedOut, output: tail }, text: `${argv.join(' ')} ${res.timedOut ? 'timed out' : `failed (exit ${res.code})`}\n${tail}`, next_actions: [{ cmd: 'ts-opt findings show <F-id>', why: 'fix the manifest edit inside the finding\'s touches, then run `ts-opt pm install` again' }] };
    }
    return { result: { pm: d.pm.name, argv, exit: 0, changed }, text: `${argv.join(' ')}: ok${changed.length ? `\nchanged: ${changed.join(', ')}` : '\nno tracked file changed'}`, next_actions: [{ cmd: 'ts-opt check', why: 'then `ts-opt commit <F-id>`' }] };
  });
}
