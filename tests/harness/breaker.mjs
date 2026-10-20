#!/usr/bin/env node
// Seed the F01 "hidden consumer" breaker (ledger rows 3.2 / 3.1): a surface-snapshot test loads every src module by a name read
// from a JSON file and pins the number of exports. Nothing names `normalize` or `internal`, so neither tsc nor a symbol search
// finds the consumer; un-exporting `normalize` is green for the fast check and red for the wave gate (the test leg).
//   node tests/harness/breaker.mjs            (TSOPT_NS selects the work copy; resets F01, adds + commits the breaker, audits it)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditFixture } from './fixrun.mjs';
import { ensureFixture } from './fixture.mjs';
import { git } from './applying.mjs';

export const BREAKER_TEST = `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The public surface of the modules below is pinned: callers outside this repo load them by file name.
const surface: Record<string, number> = JSON.parse(readFileSync(new URL('./surface.json', import.meta.url), 'utf8'));

for (const [file, exported] of Object.entries(surface)) {
  test(\`\${file} keeps its public surface\`, async () => {
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ '../src/' + file);
    expect(Object.keys(mod)).toHaveLength(exported);
  });
}
`;

export function seedBreaker(fixture = 'F01') {
  const dir = ensureFixture(fixture, { reset: true });
  const modules = ['internal.ts', 'wrapper.ts', 'flags.ts', 'errors.ts'];
  const counts = {};
  for (const m of modules) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${join(dir, 'src', m)}').then((x) => console.log(Object.keys(x).length))`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cannot load ${m}: ${r.stderr}`);
    counts[m] = Number(r.stdout.trim());
  }
  writeFileSync(join(dir, 'test', 'surface.json'), JSON.stringify(counts, null, 2) + '\n');
  writeFileSync(join(dir, 'test', 'surface.test.ts'), BREAKER_TEST);
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-m', 'test: pin the public surface of the published modules');
  if (c.status !== 0) throw new Error(c.stderr);
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedBreaker('F01');
  const dir = auditFixture('F01', { reset: false });
  console.log(dir);
}
