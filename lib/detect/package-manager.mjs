// Package manager detection and how to run binaries/scripts (doc 05 §4).
import { join } from 'node:path';
import { isFile, readText } from '../core/fs.mjs';

const has = (root, f) => isFile(join(root, f));

/** -> { name, version, source, pnp, exec:[argv prefix], run:[argv prefix for scripts] } */
export function detectPackageManager(root, pkgJson) {
  const field = pkgJson && typeof pkgJson.packageManager === 'string' ? /^([a-z]+)@([^+]+)/.exec(pkgJson.packageManager) : null;
  let name = null; let version = null; let source = null;
  if (field) { name = field[1]; version = field[2]; source = 'packageManager'; }
  else if (has(root, 'pnpm-lock.yaml')) { name = 'pnpm'; source = 'lockfile'; }
  else if (has(root, 'yarn.lock')) { name = 'yarn'; source = 'lockfile'; }
  else if (has(root, 'bun.lock') || has(root, 'bun.lockb')) { name = 'bun'; source = 'lockfile'; }
  else if (has(root, 'package-lock.json') || has(root, 'npm-shrinkwrap.json')) { name = 'npm'; source = 'lockfile'; }
  else if ((has(root, 'deno.json') || has(root, 'deno.jsonc')) && has(root, 'deno.lock')) { name = 'deno'; source = 'deno.lock'; }
  else if (pkgJson) { name = 'npm'; source = 'default'; }
  else if (has(root, 'deno.json') || has(root, 'deno.jsonc')) { name = 'deno'; source = 'deno.json'; }
  else { name = 'none'; source = null; }

  // Yarn Berry (>= 2, or any repo with .yarnrc.yml) defaults to Plug'n'Play unless nodeLinker says otherwise.
  let pnp = false;
  if (name === 'yarn') {
    const rc = readText(join(root, '.yarnrc.yml'));
    const berry = rc !== null || Number(String(version || '0').split('.')[0]) >= 2;
    pnp = berry && !/nodeLinker:\s*['"]?(node-modules|pnpm)/.test(rc || '');
  }
  const exec = { npm: ['npm', 'exec', '--'], pnpm: ['pnpm', 'exec'], yarn: ['yarn', 'run'], bun: ['bun', 'x'] }[name] || null;
  const run = { npm: ['npm', 'run'], pnpm: ['pnpm', 'run'], yarn: ['yarn', 'run'], bun: ['bun', 'run'], deno: ['deno', 'task'] }[name] || null;
  return { name, version, source, pnp, exec, run };
}
