// Test helper: build a run that is ready for the fix phase on a fixture, without an LLM.
//   scan -> auto-verdict (SEEDS) -> findings ingest -> approve chosen findings -> lock -> (optionally) begin a wave
// While the real `run begin` / `plan lock` commands are being built this crafts the same state by hand; once they exist it calls them.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, REPO, ensureFixture } from './fixture.mjs';

const env = () => ({ ...process.env, TS_OPT_HOME: join(DEV, 'home') });
export const cli = (args, cwd, extraEnv = {}) => spawnSync(process.execPath, [join(REPO, 'bin', 'ts-opt'), ...args], { cwd, encoding: 'utf8', env: { ...env(), ...extraEnv } });

export function auditFixture(id, { mode = 'standard', reset = true } = {}) {
  const work = ensureFixture(id, { reset });
  let r = cli(['scan', '--cwd', work, '--quiet', '--mode', mode, '--abandon-open'], work);
  if (r.status !== 0) throw new Error(`scan failed: ${r.stderr}`);
  r = spawnSync(process.execPath, [join(REPO, 'tests', 'harness', 'auto-verdict.mjs'), id], { encoding: 'utf8', env: env() });
  if (r.status !== 0) throw new Error(`auto-verdict failed: ${r.stderr}`);
  r = cli(['findings', 'ingest', '--cwd', work], work);
  if (r.status !== 0) throw new Error(`ingest failed: ${r.stderr}`);
  return work;
}

export const latestRun = (work) => {
  const d = join(work, '.ts-optimize', 'runs');
  return readdirSync(d).map((r) => [r, JSON.parse(readFileSync(join(d, r, 'run.json'), 'utf8')).created]).sort((a, b) => (a[1] < b[1] ? -1 : 1)).pop()[0];
};
export const runPath = (work, ...p) => join(work, '.ts-optimize', 'runs', latestRun(work), ...p);
export const readRunJson = (work) => JSON.parse(readFileSync(runPath(work, 'run.json'), 'utf8'));
export const writeRunJson = (work, run) => writeFileSync(runPath(work, 'run.json'), JSON.stringify(run, null, 2) + '\n');
