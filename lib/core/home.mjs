// TS_OPT_HOME resolution (doc 02 §6): CLAUDE_PLUGIN_DATA -> derived from plugin cache path -> XDG cache -> tmp.
import { accessSync, constants, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sanitize = (s) => s.replace(/[^A-Za-z0-9_-]/g, '-');

function writable(dir) {
  try { mkdirSync(dir, { recursive: true }); accessSync(dir, constants.W_OK); return true; } catch { return false; }
}

export function tsOptHome() {
  const env = process.env;
  if (env.TS_OPT_HOME) return env.TS_OPT_HOME;
  // only this plugin's own data dir (`ts-optimize-<marketplace>`, or `ts-optimize-inline` for --plugin-dir): a Bash environment can carry
  // another plugin's CLAUDE_PLUGIN_DATA (an exported hook env), and the toolbox must not land in that plugin's directory
  if (env.CLAUDE_PLUGIN_DATA && basename(resolve(env.CLAUDE_PLUGIN_DATA)).startsWith('ts-optimize-')) return env.CLAUDE_PLUGIN_DATA;
  // …/plugins/cache/<marketplace>/<plugin>/<version>/  ->  ~/.claude/plugins/data/<plugin>-<marketplace>/
  const parts = PLUGIN_ROOT.split(sep);
  const i = parts.lastIndexOf('cache');
  if (i >= 0 && parts[i - 1] === 'plugins' && parts.length >= i + 4) {
    const [marketplace, plugin] = [parts[i + 1], parts[i + 2]];
    const dir = join(parts.slice(0, i).join(sep), 'data', `${sanitize(plugin)}-${sanitize(marketplace)}`);
    if (writable(dir)) return dir;
  }
  const xdg = join(env.XDG_CACHE_HOME || join(homedir() || tmpdir(), '.cache'), 'ts-optimize');
  if (writable(xdg)) return xdg;
  return join(tmpdir(), 'ts-optimize');
}
