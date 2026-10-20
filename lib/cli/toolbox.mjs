// ts-opt toolbox status|install|remove — pinned engines in $TS_OPT_HOME, never in the audited project (doc 02 §6).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { readJsonc, writeAtomic } from '../core/fs.mjs';
import { PLUGIN_ROOT, tsOptHome } from '../core/home.mjs';
import { log } from '../core/log.mjs';
import { run as runProc } from '../core/proc.mjs';

export const spec = { yes: 'boolean', native: 'boolean', engines: 'boolean' };
const PARTS = { engines: ['toolbox', 'toolbox'], native: ['toolbox-native', 'toolbox-native'] }; // [source dir in plugin, dir under TS_OPT_HOME]

function versionsOf(dir) {
  const out = {};
  const nm = join(dir, 'node_modules');
  for (const n of ['knip', 'typescript', 'type-coverage', '@ast-grep/cli']) {
    const p = join(nm, ...n.split('/'), 'package.json');
    if (existsSync(p)) { try { out[n] = JSON.parse(readFileSync(p, 'utf8')).version; } catch { /* unreadable */ } }
  }
  return out;
}

function status(home) {
  const consent = readJsonc(join(home, 'consent.json'));
  return {
    home, consent: consent.ok ? consent.value.toolbox ?? 'unset' : 'unset',
    engines: { installed: existsSync(join(home, 'toolbox', 'node_modules')), versions: versionsOf(join(home, 'toolbox')) },
    native: { installed: existsSync(join(home, 'toolbox-native', 'node_modules')), versions: versionsOf(join(home, 'toolbox-native')) },
  };
}

export async function run({ flags, args }) {
  const home = tsOptHome();
  const sub = args[0] || 'status';
  if (sub === 'status') {
    const s = status(home);
    return { result: s, text: [`toolbox home: ${home}`, `consent: ${s.consent}`, `engines: ${s.engines.installed ? 'installed ' + JSON.stringify(s.engines.versions) : 'not installed'}`, `native compiler: ${s.native.installed ? 'installed ' + JSON.stringify(s.native.versions) : 'not installed'}`].join('\n') };
  }
  if (sub === 'remove') {
    for (const [, d] of Object.values(PARTS)) rmSync(join(home, d), { recursive: true, force: true });
    return { result: status(home), text: 'toolbox removed' };
  }
  if (sub === 'install') {
    if (!flags.yes) throw new TsOptError(EXIT.PRECONDITION, 'the toolbox installs pinned engines into a per-machine directory and needs the user\'s consent', 'ask the user, then re-run with --yes');
    const which = flags.native ? ['native'] : flags.engines ? ['engines'] : ['engines', 'native'];
    const done = [];
    for (const w of which) {
      const [src, dst] = PARTS[w];
      const dir = join(home, dst);
      mkdirSync(dir, { recursive: true });
      cpSync(join(PLUGIN_ROOT, src, 'package.json'), join(dir, 'package.json'));
      cpSync(join(PLUGIN_ROOT, src, 'package-lock.json'), join(dir, 'package-lock.json'));
      log(`[toolbox] npm ci --ignore-scripts in ${dir}`);
      const r = await runProc(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, timeoutMs: 180_000 });
      if (r.code !== 0) throw new TsOptError(EXIT.CAPABILITY, `toolbox install failed (${w}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`, 'check the network connection; the project is untouched');
      done.push(w);
    }
    const c = readJsonc(join(home, 'consent.json'));
    writeAtomic(join(home, 'consent.json'), JSON.stringify({ ...(c.ok ? c.value : {}), toolbox: 'allow' }, null, 2) + '\n');
    const s = status(home);
    return { result: { installed: done, ...s }, text: `installed: ${done.join(', ')}\n${JSON.stringify(s.engines.versions)}` };
  }
  throw new TsOptError(EXIT.USAGE, 'usage: ts-opt toolbox status|install [--engines|--native] --yes|remove');
}
