#!/usr/bin/env node
// Seed the F01 "bundler glob" breaker: a test reads `normalize` through a computed dynamic import, so Knip (and tsc) see
// `normalize` as internal-only (reach-04) while un-exporting it breaks a test the typechecker cannot see (ledger rows 3.2 / 6).
//   node tests/harness/breaker.mjs            (TSOPT_NS selects the work copy; resets F01, adds + commits the breaker, audits it)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditFixture } from './fixrun.mjs';
import { ensureFixture } from './fixture.mjs';
import { git } from './applying.mjs';

export const BREAKER = `import { expect, test } from 'vitest';

// The plugin loader resolves helpers by a name assembled at runtime; neither tsc nor a text search finds this consumer.
const helper = ['norm', 'alize'].join('');
test('the loader finds its helper by name', async () => {
  const mod: Record<string, unknown> = await import('../src/' + ['inter', 'nal'].join(''));
  expect(typeof mod[helper]).toBe('function');
});
`;

export function seedBreaker(fixture = 'F01') {
  const dir = ensureFixture(fixture, { reset: true });
  writeFileSync(join(dir, 'test', 'plugin-loader.test.ts'), BREAKER);
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-m', 'seed: dynamic consumer of normalize');
  if (c.status !== 0) throw new Error(c.stderr);
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedBreaker('F01');
  const dir = auditFixture('F01', { reset: false });
  console.log(dir);
}
