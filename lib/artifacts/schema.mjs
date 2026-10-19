// Minimal JSON Schema (2020-12 subset) validator for ts-optimize artifacts. Zero dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');
const MAX_ERRORS = 50;

export const KINDS = Object.freeze([
  'candidate', 'chunk', 'verdict', 'proposal', 'rule', 'finding', 'findings-index', 'run',
  'plan', 'plan-lock', 'baseline', 'suppressions', 'config', 'envelope', 'fit', 'log-event',
]);

const cache = new Map();

export function loadSchema(kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown schema kind: ${kind}`);
  if (!cache.has(kind)) cache.set(kind, JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${kind}.schema.json`), 'utf8')));
  return cache.get(kind);
}

function versionOf(kind) {
  const c = loadSchema(kind).properties?.schema?.const;
  const m = /@(\d+)$/.exec(String(c));
  return m ? Number(m[1]) : 1;
}

export const SUPPORTED = Object.freeze(Object.fromEntries(KINDS.map((k) => [k, versionOf(k)])));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeOk(t, v) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'object': return isObj(v);
    case 'array': return Array.isArray(v);
    default: return false;
  }
}

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  let cur = root;
  for (const seg of ref.slice(2).split('/')) cur = cur?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
  if (cur === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  return cur;
}

const show = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 60 ? s.slice(0, 57) + '...' : s); };
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

function check(schema, value, p, root, errs) {
  if (errs.length >= MAX_ERRORS || schema === true || !isObj(schema)) return;
  const add = (message) => { if (errs.length < MAX_ERRORS) errs.push({ path: p || '/', message }); };
  if (schema.$ref) check(resolveRef(schema.$ref, root), value, p, root, errs);
  if (schema.type !== undefined) {
    const ts = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!ts.some((t) => typeOk(t, value))) { add(`expected type ${ts.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`); return; }
  }
  if ('const' in schema && !deepEq(schema.const, value)) add(`must equal ${show(schema.const)}, got ${show(value)}`);
  if (schema.enum && !schema.enum.some((e) => deepEq(e, value))) add(`must be one of ${schema.enum.map(show).join(', ')}, got ${show(value)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`string shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`string longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) add(`does not match pattern ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) add(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => check(schema.items, item, `${p}/${i}`, root, errs));
  }
  if (isObj(value)) {
    for (const k of schema.required || []) if (!(k in value)) add(`missing required property "${k}"`);
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (k in props) check(props[k], value[k], `${p}/${esc(k)}`, root, errs);
      else if (schema.additionalProperties === false) add(`unexpected property "${k}"`);
      else if (isObj(schema.additionalProperties)) check(schema.additionalProperties, value[k], `${p}/${esc(k)}`, root, errs);
    }
  }
  if (schema.allOf) for (const s of schema.allOf) check(s, value, p, root, errs);
  if (schema.anyOf && !schema.anyOf.some((s) => sub(s, value, p, root))) add('does not match any of the allowed shapes (anyOf)');
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => sub(s, value, p, root)).length;
    if (n !== 1) add(n === 0 ? 'does not match any of the allowed shapes (oneOf)' : 'matches more than one shape (oneOf)');
  }
}

function sub(schema, value, p, root) {
  const e = [];
  check(schema, value, p, root, e);
  return e.length === 0;
}

export function validate(kind, value) {
  const schema = loadSchema(kind);
  const errors = [];
  check(schema, value, '', schema, errors);
  return { ok: errors.length === 0, errors };
}

export function checkSchemaId(value) {
  const id = typeof value === 'string' ? value : (isObj(value) ? value.schema : undefined);
  if (id === undefined || id === null || id === '') return { ok: false, reason: 'missing' };
  const m = typeof id === 'string' ? /^ts-optimize\/([a-z][a-z-]*)@(\d+)$/.exec(id) : null;
  if (!m) return { ok: false, reason: 'malformed' };
  const kind = m[1];
  const version = Number(m[2]);
  if (!KINDS.includes(kind)) return { ok: false, reason: 'unknown-kind', kind, version };
  const supported = SUPPORTED[kind];
  if (version > supported) return { ok: false, reason: 'incompatible', kind, version, supported };
  return version < supported ? { ok: true, kind, version, older: true } : { ok: true, kind, version };
}
