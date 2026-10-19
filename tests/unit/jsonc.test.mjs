import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc, tryParseJsonc, stripJsonc } from '../../lib/core/jsonc.mjs';

const corpus = (name) => readFileSync(new URL(`../corpora/${name}`, import.meta.url), 'utf8');

test('plain JSON values', () => {
  assert.deepEqual(parseJsonc('{"a":[1,2.5,-3e2,true,false,null,"x"]}'), { a: [1, 2.5, -300, true, false, null, 'x'] });
});
test('scalars at top level', () => {
  assert.equal(parseJsonc('42'), 42);
  assert.equal(parseJsonc(' "s" '), 's');
  assert.equal(parseJsonc('null'), null);
});
test('line comments', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": 1 // d\n}'), { a: 1 });
});
test('block comments including multi-line', () => {
  assert.deepEqual(parseJsonc('/* a\n b */{"a":/* x */1}'), { a: 1 });
});
test('trailing comma in object', () => {
  assert.deepEqual(parseJsonc('{"a":1,}'), { a: 1 });
});
test('trailing comma in array', () => {
  assert.deepEqual(parseJsonc('[1,2,]'), [1, 2]);
});
test('trailing comma followed by comment', () => {
  assert.deepEqual(parseJsonc('{"a":[1, // x\n],\n/* y */}'), { a: [1] });
});
test('comment-looking text inside strings is preserved', () => {
  assert.deepEqual(parseJsonc('{"u":"http://x.y/*z*/","v":"// no"}'), { u: 'http://x.y/*z*/', v: '// no' });
});
test('UTF-8 BOM', () => {
  assert.deepEqual(parseJsonc('﻿{"a":1}'), { a: 1 });
});
test('CRLF line endings', () => {
  assert.deepEqual(parseJsonc('{\r\n// c\r\n"a": 1,\r\n}\r\n'), { a: 1 });
});
test('duplicate keys: last wins', () => {
  assert.deepEqual(parseJsonc('{"a":1,"a":2}'), { a: 2 });
});
test('__proto__ key is an own property, not a prototype change', () => {
  const v = parseJsonc('{"__proto__":{"x":1}}');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__']);
});
test('string escapes', () => {
  assert.equal(parseJsonc('"a\\n\\t\\"\\\\\\/\\u0041\\u00e9"'), 'a\n\t"\\/Aé');
});
test('nesting of 200 levels parses', () => {
  const s = '['.repeat(200) + ']'.repeat(200);
  let v = parseJsonc(s);
  let d = 0;
  while (Array.isArray(v) && v.length) { v = v[0]; d++; }
  assert.equal(d, 199);
});
test('absurd nesting is an error, not a stack overflow', () => {
  const r = tryParseJsonc('['.repeat(100000));
  assert.equal(r.ok, false);
});
test('unterminated string', () => {
  assert.throws(() => parseJsonc('{"a":"b'), /Unterminated string/);
});
test('string with raw newline is unterminated', () => {
  assert.throws(() => parseJsonc('"a\nb"'), /Unterminated string/);
});
test('unterminated block comment', () => {
  assert.throws(() => parseJsonc('{} /* oops'), /Unterminated comment/);
});
test('unterminated object and array', () => {
  assert.throws(() => parseJsonc('{"a":1'), /Unterminated object/);
  assert.throws(() => parseJsonc('[1,'), /Unterminated array|Unexpected end/);
});
test('error carries offset, line and column', () => {
  try {
    parseJsonc('{\n  "a": 1,\n  "b": ?\n}');
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.line, 3);
    assert.equal(e.column, 8);
    assert.equal(e.offset, 19);
  }
});
test('empty and whitespace-only input', () => {
  assert.throws(() => parseJsonc(''), /Empty input/);
  assert.throws(() => parseJsonc('  // only comment\n'), /Empty input/);
});
test('double comma, leading comma, missing colon', () => {
  assert.throws(() => parseJsonc('[1,,2]'));
  assert.throws(() => parseJsonc('[,]'));
  assert.throws(() => parseJsonc('{"a" 1}'));
  assert.throws(() => parseJsonc('{,}'));
});
test('single quotes, bare keys and bad numbers are rejected', () => {
  assert.throws(() => parseJsonc("{'a':1}"));
  assert.throws(() => parseJsonc('{a:1}'));
  assert.throws(() => parseJsonc('[01]'));
  assert.throws(() => parseJsonc('[+1]'));
});
test('trailing garbage after the value', () => {
  assert.throws(() => parseJsonc('{} x'), /after JSON value/);
});
test('tryParseJsonc ok and error shapes', () => {
  assert.deepEqual(tryParseJsonc('[1,]'), { ok: true, value: [1] });
  const r = tryParseJsonc('{');
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});
test('tryParseJsonc tolerates non-string input', () => {
  for (const bad of [undefined, null, 5, {}, [], Buffer.from('{}')]) {
    const r = tryParseJsonc(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
});
test('stripJsonc preserves length and positions', () => {
  const src = '{ // c\n "a": [1,2,], /* x */ "b": "// k" ,\n}';
  const out = stripJsonc(src);
  assert.equal(out.length, src.length);
  assert.deepEqual(JSON.parse(out), { a: [1, 2], b: '// k' });
  assert.equal(out.indexOf('"b"'), src.indexOf('"b"'));
  assert.equal(out.split('\n').length, src.split('\n').length);
});
test('stripJsonc handles BOM, unterminated comment and non-string', () => {
  assert.equal(stripJsonc('﻿{}').length, 3);
  assert.doesNotThrow(() => stripJsonc('{} /* x'));
  assert.equal(stripJsonc(null), '');
});
test('corpus: tsconfig with BOM, CRLF, comments, trailing commas', () => {
  const raw = corpus('tsconfig.bom-crlf-comments.json');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  assert.ok(raw.includes('\r\n'));
  const v = parseJsonc(raw);
  assert.equal(v.compilerOptions.module, 'NodeNext');
  assert.deepEqual(v.compilerOptions.paths['@glob/*'], ['./src/**/*.ts', '/* not a comment */']);
  assert.equal(v.compilerOptions.outDir, 'dist//out');
  assert.deepEqual(v.include, ['src/**/*', '//weird']);
  assert.deepEqual(JSON.parse(stripJsonc(raw)), v);
});
test('corpus: tsconfig with extends array', () => {
  const v = parseJsonc(corpus('tsconfig.extends-array.json'));
  assert.deepEqual(v.extends, ['./tsconfig.base.json', '@tsconfig/node22/tsconfig.json', './a']);
  assert.equal(v.references.length, 2);
});
test('corpus: wrangler.jsonc', () => {
  const v = parseJsonc(corpus('wrangler.jsonc'));
  assert.equal(v.main, 'src/index.ts');
  assert.deepEqual(v.compatibility_flags, ['nodejs_compat']);
  assert.equal(v.durable_objects.bindings[0].class_name, 'Counter');
  assert.equal(v.vars.API_URL, 'https://api.example.com/v1');
});
test('corpus: package.json with workspaces', () => {
  const v = parseJsonc(corpus('package.workspaces.json'));
  assert.deepEqual(v.workspaces, ['apps/*', 'packages/**', '!packages/legacy']);
});
