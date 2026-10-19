import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, satisfies, coerce, major } from '../../lib/core/semver.mjs';

const ok = (v, r) => assert.equal(satisfies(v, r), true, `${v} should satisfy ${r}`);
const bad = (v, r) => assert.equal(satisfies(v, r), false, `${v} should not satisfy ${r}`);

test('parseVersion basic', () => {
  const v = parseVersion('1.2.3');
  assert.deepEqual([v.major, v.minor, v.patch, v.prerelease, v.build, v.raw], [1, 2, 3, [], [], '1.2.3']);
});
test('parseVersion prerelease and build', () => {
  const v = parseVersion('1.2.3-beta.1+sha.5');
  assert.deepEqual(v.prerelease, ['beta', 1]);
  assert.deepEqual(v.build, ['sha', '5']);
});
test('parseVersion accepts leading v and =', () => {
  assert.equal(parseVersion('v1.2.3').major, 1);
  assert.equal(parseVersion('=1.2.3').minor, 2);
  assert.equal(parseVersion('=v1.2.3').patch, 3);
});
test('parseVersion rejects junk', () => {
  for (const s of ['1.2', 'x', '', '1.2.3.4', '^1.2.3', 'latest', 'workspace:*', null, undefined, 5]) {
    assert.equal(parseVersion(s), null, String(s));
  }
});
test('compareVersions numeric ordering is not lexical', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});
test('compareVersions ignores build metadata', () => {
  assert.equal(compareVersions('1.0.0+a', '1.0.0+b'), 0);
});
test('compareVersions prerelease ordering per semver 2.0', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compareVersions(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`);
    assert.equal(compareVersions(order[i + 1], order[i]), 1);
  }
});
test('compareVersions accepts parsed objects and throws TypeError on junk', () => {
  assert.equal(compareVersions(parseVersion('2.0.0'), '1.0.0'), 1);
  assert.throws(() => compareVersions('nope', '1.0.0'), TypeError);
});
test('caret ranges', () => {
  ok('1.2.3', '^1.2.3');
  ok('1.9.0', '^1.2.3');
  bad('2.0.0', '^1.2.3');
  bad('1.2.2', '^1.2.3');
  ok('0.2.5', '^0.2.3');
  bad('0.3.0', '^0.2.3');
  ok('0.0.3', '^0.0.3');
  bad('0.0.4', '^0.0.3');
  ok('1.5.0', '^1');
  ok('1.5.0', '^1.x');
  ok('0.9.0', '^0');
});
test('tilde ranges', () => {
  ok('1.2.9', '~1.2.3');
  bad('1.3.0', '~1.2.3');
  ok('1.9.9', '~1');
  ok('1.2.0', '~1.2');
  bad('1.3.0', '~1.2');
});
test('comparison operators', () => {
  ok('2.0.0', '>=1.2.3');
  ok('1.2.3', '>=1.2.3');
  bad('1.2.2', '>=1.2.3');
  ok('1.2.4', '>1.2.3');
  bad('1.2.3', '>1.2.3');
  ok('1.2.2', '<=1.2.3');
  bad('1.2.4', '<=1.2.3');
  ok('1.2.2', '<1.2.3');
  ok('1.2.3', '=1.2.3');
  ok('1.2.3', '1.2.3');
  bad('1.2.4', '1.2.3');
});
test('operators with spaces before the version', () => {
  ok('1.5.0', '>= 1.2.3 < 2.0.0');
  ok('1.5.0', '^ 1.2.3');
});
test('space-ANDed comparators', () => {
  ok('1.5.0', '>=1.2.0 <2.0.0');
  bad('2.0.0', '>=1.2.0 <2.0.0');
  bad('1.1.0', '>=1.2.0 <2.0.0');
});
test('|| unions', () => {
  ok('1.5.0', '^1.0.0 || ^3.0.0');
  ok('3.1.0', '^1.0.0 || ^3.0.0');
  bad('2.0.0', '^1.0.0 || ^3.0.0');
  ok('18.3.1', '^16 || ^17 || ^18');
});
test('hyphen ranges', () => {
  ok('1.2.3', '1.2.3 - 2.3.4');
  ok('2.3.4', '1.2.3 - 2.3.4');
  bad('2.3.5', '1.2.3 - 2.3.4');
  ok('2.3.9', '1.2.3 - 2.3');
  bad('2.4.0', '1.2.3 - 2.3');
  ok('2.9.9', '1 - 2');
  bad('3.0.0', '1 - 2');
});
test('wildcards x X *', () => {
  ok('1.2.9', '1.2.x');
  ok('1.2.9', '1.2.X');
  ok('1.2.9', '1.2.*');
  bad('1.3.0', '1.2.x');
  ok('1.9.0', '1.x');
  ok('9.9.9', '*');
  ok('9.9.9', 'x');
  ok('9.9.9', '');
  ok('1.2.3', '1');
  bad('2.0.0', '1');
});
test('partials in comparisons', () => {
  ok('1.9.9', '<2');
  bad('2.0.0', '<2');
  ok('2.0.0', '>1');
  bad('1.9.9', '>1');
  ok('1.2.9', '<=1.2');
  bad('1.3.0', '<=1.2');
  bad('1.0.0', '>*');
});
test('prerelease only satisfies comparators naming the same tuple', () => {
  bad('1.2.3-beta.1', '^1.2.0');
  bad('1.2.3-beta.1', '*');
  bad('1.3.0-beta.1', '>=1.2.3');
  ok('1.2.3-beta.2', '>=1.2.3-beta.1');
  ok('1.2.3-beta.2', '^1.2.3-beta.1');
  bad('1.2.4-beta.1', '>=1.2.3-beta.1');
  bad('2.0.0-alpha', '^1.2.3');
  ok('1.2.3-beta.1', '1.2.3-beta.1');
});
test('prerelease union branch', () => {
  ok('1.2.3-rc.1', '^1.0.0 || >=1.2.3-rc.0');
});
test('v prefix and = on the version argument', () => {
  ok('v1.2.3', '^1.0.0');
  ok('=1.2.3', '1.2.3');
});
test('non-semver specifiers never satisfy and never throw', () => {
  for (const r of ['workspace:*', 'workspace:^1.2.3', 'catalog:', 'catalog:react', 'latest', 'next', 'github:user/repo', 'git+https://x.y/z.git', 'file:../x', 'link:../x', 'https://x.y/z.tgz', 'npm:typescript@^7', 'banana']) {
    assert.equal(satisfies('1.2.3', r), false, r);
  }
});
test('satisfies tolerates bad arguments', () => {
  for (const [v, r] of [[null, '^1'], ['1.2.3', null], ['junk', '^1'], [undefined, undefined], [{}, '^1'], ['1.2.3', 'x'.repeat(5000)]]) {
    assert.doesNotThrow(() => satisfies(v, r));
  }
  bad('junk', '*');
});
test('a bad set in || does not poison valid sets', () => {
  ok('1.2.3', 'latest || ^1.0.0');
});
test('coerce', () => {
  assert.equal(coerce('v5.9.x'), '5.9.0');
  assert.equal(coerce('workspace:^1.2.3'), '1.2.3');
  assert.equal(coerce('npm:typescript@^7'), '7.0.0');
  assert.equal(coerce('npm:@scope/pkg@~2.1'), '2.1.0');
  assert.equal(coerce('^5.9.3'), '5.9.3');
  assert.equal(coerce('>=18'), '18.0.0');
  assert.equal(coerce('5'), '5.0.0');
  assert.equal(coerce('1.2.3-beta.1'), '1.2.3');
  assert.equal(coerce('5.*'), '5.0.0');
});
test('coerce returns null for non-versions', () => {
  for (const s of ['latest', 'catalog:', 'workspace:*', 'github:user/repo#semver:^1.2', 'https://x.y/1.2.3.tgz', '', null, undefined, 3]) {
    assert.equal(coerce(s), null, String(s));
  }
});
test('major', () => {
  assert.equal(major('^7.1.0'), 7);
  assert.equal(major('v18'), 18);
  assert.equal(major('npm:typescript@^7'), 7);
  assert.equal(major('latest'), null);
});
