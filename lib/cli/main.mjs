// ts-opt entry: command table, global flags, envelope, exit codes (doc 02 §3).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './args.mjs';
import { EXIT, TsOptError, envelope, errorEnvelope } from '../core/envelope.mjs';
import { PLUGIN_ROOT } from '../core/home.mjs';
import { setQuiet } from '../core/log.mjs';

// command name -> module (each exports `spec` and `run(ctx)`)
const COMMANDS = {
  detect: './detect.mjs',
  doctor: './doctor.mjs',
  toolbox: './toolbox.mjs',
  scan: './scan.mjs',
  verdict: './verdict.mjs',
  triage: './triage.mjs',
  findings: './findings.mjs',
  rule: './rule.mjs',
  validate: './validate.mjs',
};

export function pluginVersion() {
  try { return JSON.parse(readFileSync(resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return 'unknown'; }
}

function usage() {
  return `ts-opt ${pluginVersion()} — TypeScript audit/fix engine for the ts-optimize Claude Code plugin

usage: ts-opt <command> [options]      global: --cwd <dir> --run <id|latest|open> --json --quiet --no-color
commands: ${Object.keys(COMMANDS).join(' ')}
`;
}

export async function main(argv) {
  let cmdIdx = -1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' || a === '--run') { i++; continue; }
    if (a.startsWith('--')) continue;
    cmdIdx = i; break;
  }
  const cmdName = cmdIdx >= 0 ? argv[cmdIdx] : undefined;
  const wantJson = argv.includes('--json');
  try {
    if (!cmdName || argv[0] === '--help' || argv[0] === '-h') { process.stdout.write(usage()); return cmdName ? EXIT.OK : EXIT.USAGE; }
    if (argv[0] === '--version') { process.stdout.write(pluginVersion() + '\n'); return EXIT.OK; }
    const modPath = COMMANDS[cmdName];
    if (!modPath) throw new TsOptError(EXIT.USAGE, `unknown command "${cmdName}"`, usage());
    const mod = await import(new URL(modPath, import.meta.url).href);
    const rest = argv.filter((a, i) => i !== cmdIdx);
    const { flags, positional } = parseArgs(rest, mod.spec || {});
    if (flags.quiet) setQuiet(true);
    const cwd = resolve(flags.cwd || process.cwd());
    const out = await mod.run({ cwd, flags, args: positional, json: !!flags.json });
    const exit = out.exit ?? EXIT.OK;
    if (flags.json) {
      process.stdout.write(JSON.stringify(envelope({ ok: exit === EXIT.OK, result: out.result ?? null, warnings: out.warnings || [], next_actions: out.next_actions || [] })) + '\n');
    } else if (out.text !== undefined) {
      process.stdout.write(out.text.endsWith('\n') ? out.text : out.text + '\n');
    }
    return exit;
  } catch (e) {
    const err = e instanceof TsOptError ? e : new TsOptError(EXIT.INTERNAL, String(e && e.message || e), null, 'internal');
    if (!(e instanceof TsOptError) && process.env.TS_OPT_DEBUG) process.stderr.write(String(e && e.stack) + '\n');
    if (wantJson) process.stdout.write(JSON.stringify(errorEnvelope(err)) + '\n');
    else process.stderr.write(`ts-opt: ${err.message}${err.hint ? '\n' + err.hint : ''}\n`);
    return err.code;
  }
}
