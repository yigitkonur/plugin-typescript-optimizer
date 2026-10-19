import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileGlob, matchGlob, filterGlobs, toPosix } from '../../lib/core/glob.mjs';

const yes = (p, s, o) => assert.equal(matchGlob(p, s, o), true, `${p} should match ${s}`);
const no = (p, s, o) => assert.equal(matchGlob(p, s, o), false, `${p} should not match ${s}`);

test('literal paths', () => {
  yes('src/a.ts', 'src/a.ts');
  no('src/a.ts', 'src/b.ts');
  no('src/a.ts', 'xsrc/a.ts');
});
test('* does not cross /', () => {
  yes('packages/*', 'packages/a');
  no('packages/*', 'packages/a/b');
  no('packages/*', 'packages');
  no('packages/*', 'packages/');
});
test('* inside a segment', () => {
  yes('src/*.ts', 'src/a.ts');
  no('src/*.ts', 'src/a.tsx');
  yes('a*c', 'abbbc');
  yes('a*c', 'ac');
});
test('? matches exactly one non-slash char', () => {
  yes('a?c', 'abc');
  no('a?c', 'ac');
  no('a?c', 'abbc');
  no('a?c', 'a/c');
});
test('** matches zero or more segments (middle)', () => {
  yes('src/**/x.ts', 'src/x.ts');
  yes('src/**/x.ts', 'src/a/b/x.ts');
  no('src/**/x.ts', 'lib/x.ts');
});
test('** leading and trailing', () => {
  yes('**/x.ts', 'x.ts');
  yes('**/x.ts', 'a/b/x.ts');
  yes('a/**', 'a/b/c');
  yes('a/**', 'a');
  no('a/**', 'b/c');
  yes('**', 'a/b');
});
test('** is only special as a whole segment', () => {
  yes('a**b', 'axxb');
  no('a**b', 'ax/xb');
});
test('braces', () => {
  yes('*.{ts,tsx}', 'a.tsx');
  yes('*.{ts,tsx}', 'a.ts');
  no('*.{ts,tsx}', 'a.js');
  yes('{apps,packages}/*', 'apps/web');
});
test('nested braces', () => {
  yes('x/{a,b/{c,d}}/y', 'x/a/y');
  yes('x/{a,b/{c,d}}/y', 'x/b/d/y');
  no('x/{a,b/{c,d}}/y', 'x/b/e/y');
});
test('brace without comma is literal', () => {
  yes('{a}', '{a}');
  no('{a}', 'a');
});
test('character classes and negation', () => {
  yes('file[abc].ts', 'fileb.ts');
  no('file[abc].ts', 'filed.ts');
  yes('file[!abc].ts', 'filed.ts');
  no('file[!abc].ts', 'filea.ts');
  yes('f[a-c]', 'fb');
});
test('unterminated class is literal', () => {
  yes('a[b', 'a[b');
});
test('leading ./ is ignored in pattern and path', () => {
  yes('./packages/*', 'packages/a');
  yes('packages/*', './packages/a');
});
test('trailing slash on the pattern or path', () => {
  yes('packages/*/', 'packages/a');
  yes('packages/*', 'packages/a/');
  no('packages/*/', 'packages/a/b');
});
test('dotfiles are not matched by wildcards by default', () => {
  no('*', '.git');
  no('**', '.git/config');
  no('**/x.ts', '.hidden/x.ts');
  no('src/*', 'src/.env');
  yes('.*', '.git');
  yes('.github/*', '.github/ci.yml');
  yes('*', '.git', { dot: true });
  yes('**/x.ts', '.hidden/x.ts', { dot: true });
});
test('regex metacharacters in patterns are literal', () => {
  yes('a+b(c).ts', 'a+b(c).ts');
  no('a.b', 'axb');
  yes('a\\*b', 'a*b');
  no('a\\*b', 'axb');
});
test('backslash paths are normalised by toPosix', () => {
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
  yes('a/b/*', 'a\\b\\c');
});
test('compileGlob returns an anchored RegExp', () => {
  const re = compileGlob('a/*');
  assert.ok(re instanceof RegExp);
  assert.equal(re.test('a/b'), true);
  assert.equal(re.test('xa/b'), false);
});
test('empty pattern matches only empty path; non-string inputs do not throw', () => {
  yes('', '');
  no('', 'a');
  assert.equal(matchGlob('a', undefined), false);
  assert.doesNotThrow(() => compileGlob(undefined));
});
test('filterGlobs: negation removes earlier matches', () => {
  const dirs = ['apps/web', 'packages/a', 'packages/legacy', 'packages/b'];
  assert.deepEqual(filterGlobs(dirs, ['apps/*', 'packages/*', '!packages/legacy']), ['apps/web', 'packages/a', 'packages/b']);
});
test('filterGlobs: order matters', () => {
  const dirs = ['packages/a', 'packages/legacy'];
  assert.deepEqual(filterGlobs(dirs, ['!packages/legacy', 'packages/*']), ['packages/a', 'packages/legacy']);
});
test('filterGlobs: sorted and de-duplicated', () => {
  assert.deepEqual(filterGlobs(['b/x', 'a/x', 'a/x', './a/x'], ['*/x', 'a/*']), ['a/x', 'b/x']);
});
test('filterGlobs: recursive negation', () => {
  const dirs = ['packages/a', 'packages/a/__fixtures__/x', 'packages/b'];
  assert.deepEqual(filterGlobs(dirs, ['packages/**', '!**/__fixtures__/**']), ['packages/a', 'packages/b']);
});
test('filterGlobs: bad input yields []', () => {
  assert.deepEqual(filterGlobs(null, ['a']), []);
  assert.deepEqual(filterGlobs(['a'], null), []);
  assert.deepEqual(filterGlobs(['a', 5], [7, 'a']), ['a']);
});
test('pattern explosion is bounded', () => {
  const p = Array.from({ length: 20 }, () => '{a,b}').join('');
  assert.doesNotThrow(() => compileGlob(p));
});
