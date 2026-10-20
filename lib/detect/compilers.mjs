// Compiler resolution (doc 05 §5): authoritative / fast / api_provider per package. Versions come from package.json files, not guesses.
import { delimiter, join, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isFile, readJsonc, walkUp } from '../core/fs.mjs';
import { run, IS_WIN } from '../core/proc.mjs';

const exe = (name) => (IS_WIN ? name + '.cmd' : name);
export const kindOf = (version) => {
  const m = /^(\d+)\./.exec(version || '');
  if (!m) return 'unknown';
  return Number(m[1]) >= 7 ? 'native' : 'js';
};

export function whichSync(bin, env = process.env) {
  for (const d of (env.PATH || '').split(delimiter)) {
    if (!d) continue;
    const p = join(d, IS_WIN ? bin + '.cmd' : bin);
    if (isFile(p)) return p;
  }
  return null;
}

/** nearest node_modules/<name>/package.json walking up from dir to root (inclusive) */
export function findPackage(dir, root, name) {
  const hit = walkUp(dir, (d) => {
    const p = join(d, 'node_modules', ...name.split('/'), 'package.json');
    return isFile(p) ? p : null;
  }, root);
  if (!hit) return null;
  const r = readJsonc(hit.value);
  return r.ok ? { dir: join(hit.dir, 'node_modules', ...name.split('/')), version: r.value.version || null, manifest: r.value } : null;
}
export function findBin(dir, root, bin) {
  const hit = walkUp(dir, (d) => { const p = join(d, 'node_modules', '.bin', exe(bin)); return existsSync(p) ? p : null; }, root);
  return hit ? hit.value : null;
}

/**
 * The package that actually provides `.bin/tsc`: normally `typescript`, but under the alias scheme (doc 05 §8.4 T2) `typescript` is
 * TypeScript 6 and `tsc` belongs to the native package installed under another name. -> {version, name} | null
 */
export function tscProvider(tscBin, pkgDir, root) {
  try {
    const real = realpathSync(tscBin).split('\\').join('/');
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?:bin|lib)\//.exec(real);
    let name = m ? m[1] : null;
    if (!name) { // npm/yarn shims on Windows are text files that name the package
      const t = readFileSync(tscBin, 'utf8').split('\\').join('/');
      const s = /node_modules\/((?:@[^/]+\/)?[^/"' ]+)\/(?:bin|lib)\//.exec(t);
      name = s ? s[1] : null;
    }
    if (!name) return null;
    const pkg = findPackage(pkgDir, root, name);
    return pkg?.version ? { version: pkg.version, name } : null;
  } catch { return null; }
}

/**
 * -> { authoritative:{kind,version,bin,source,exec?}, fast:{kind,version,bin,source}|null, api_provider:{version,dir}|null }
 */
export async function resolveCompilers(pkgDir, root, { pm, toolboxNativeBin = null } = {}) {
  const ts = findPackage(pkgDir, root, 'typescript');
  const tscBin = findBin(pkgDir, root, 'tsc');
  let authoritative;
  if (ts && tscBin) {
    const prov = tscProvider(tscBin, pkgDir, root);
    const version = prov?.version || ts.version;
    authoritative = { kind: kindOf(version), version, bin: tscBin, source: 'project', ...(prov && prov.name !== 'typescript' ? { provider: prov.name } : {}) };
  }
  else if (pm?.pnp) authoritative = { kind: 'unknown', version: null, bin: null, source: 'pnp', exec: [...(pm.exec || []), 'tsc'] };
  else {
    const p = whichSync('tsc');
    if (p) {
      const r = await run([p, '--version'], { timeoutMs: 5000 });
      const v = /Version\s+(\S+)/.exec(r.stdout)?.[1] || null;
      authoritative = { kind: kindOf(v), version: v, bin: p, source: 'path' };
    } else authoritative = { kind: 'none', version: null, bin: null, source: null };
  }
  let fast = null;
  if (authoritative.kind === 'native') fast = { kind: 'native', version: authoritative.version, bin: authoritative.bin, source: authoritative.source };
  else {
    const tsgo = findBin(pkgDir, root, 'tsgo');
    const np = tsgo && findPackage(pkgDir, root, '@typescript/native-preview');
    if (tsgo) fast = { kind: 'native-preview', version: np?.version || null, bin: tsgo, source: 'project' };
    else if (toolboxNativeBin && isFile(toolboxNativeBin)) fast = { kind: 'native', version: null, bin: toolboxNativeBin, source: 'toolbox' };
  }
  const api_provider = ts && kindOf(ts.version) === 'js' ? { version: ts.version, dir: ts.dir } : null;
  return { authoritative, fast, api_provider };
}
export { resolve };
