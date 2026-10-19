// Minimal declarative argument parser. spec = { name: 'boolean' | 'string' | 'array' | 'number' } (no leading dashes).
import { EXIT, TsOptError } from '../core/envelope.mjs';

export const GLOBAL_SPEC = { cwd: 'string', run: 'string', json: 'boolean', quiet: 'boolean', 'no-color': 'boolean', help: 'boolean' };

export function parseArgs(argv, spec = {}) {
  const full = { ...GLOBAL_SPEC, ...spec };
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a === '--') { positional.push(a); continue; }
    let [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    let neg = false;
    if (!(name in full) && name.startsWith('no-') && full[name.slice(3)] === 'boolean') { name = name.slice(3); neg = true; }
    const type = full[name];
    if (!type) throw new TsOptError(EXIT.USAGE, `unknown flag --${name}`, 'run with --help');
    if (type === 'boolean') { flags[name] = inline === undefined ? !neg : inline !== 'false'; continue; }
    let v = inline;
    if (v === undefined) {
      v = argv[++i];
      if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new TsOptError(EXIT.USAGE, `flag --${name} needs a value`);
    }
    if (type === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw new TsOptError(EXIT.USAGE, `flag --${name} needs a number`); flags[name] = n; }
    else if (type === 'array') (flags[name] ||= []).push(...String(v).split(',').filter(Boolean));
    else flags[name] = v;
  }
  return { flags, positional };
}
