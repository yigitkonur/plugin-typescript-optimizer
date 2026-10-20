// Helpers for tests/gate.test.mjs: older TypeScript versions installed once under the dev cache, and a small composite project.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV } from './fixture.mjs';

/** absolute path of `tsc` for typescript@<version> (cached in ~/.cache/ts-optimize-dev/ts-versions/<version>); null when it cannot be installed */
export function tscOf(version) {
  const dir = join(DEV, 'ts-versions', version);
  const bin = join(dir, 'node_modules', '.bin', 'tsc');
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"ts-version","version":"1.0.0","private":true}\n');
  const r = spawnSync('npm', ['i', `typescript@${version}`, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  return r.status === 0 && existsSync(bin) ? bin : null;
}

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });

/** solution tsconfig -> a, b (references a), single (no references); all composite; one git commit; returns the directory */
export function makeComposite() {
  const dir = mkdtempSync(join(tmpdir(), 'tsopt-comp-'));
  const w = (f, s) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), s); };
  w('tsconfig.base.json', '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":true,"composite":true,"declaration":true,"types":[]}}\n');
  w('tsconfig.json', '{"files":[],"references":[{"path":"a"},{"path":"b"},{"path":"single"}]}\n');
  w('a/tsconfig.json', '{"extends":"../tsconfig.base.json","compilerOptions":{"rootDir":"src","outDir":"dist"},"include":["src"]}\n');
  w('b/tsconfig.json', '{"extends":"../tsconfig.base.json","compilerOptions":{"rootDir":"src","outDir":"dist"},"include":["src"],"references":[{"path":"../a"}]}\n');
  w('single/tsconfig.json', '{"extends":"../tsconfig.base.json","compilerOptions":{"rootDir":"src","outDir":"dist"},"include":["src"]}\n');
  w('a/src/i.ts', 'export const x = 1;\n');
  w('b/src/i.ts', 'import { x } from "../../a/src/i";\nexport const y: number = x;\n');
  w('single/src/i.ts', 'export const z = 1;\n');
  w('.gitignore', 'dist\n*.tsbuildinfo\nnode_modules\n');
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
export const gitStatus = (dir) => git(dir, 'status', '--porcelain').stdout.trim();
