// tsconfig graph: resolve `extends` chains, classify configs, record signals (doc 05 §2).
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isFile, readJsonc, toPosix, walkUp } from '../core/fs.mjs';

const MAX_DEPTH = 8;

export const SIGNAL_KEYS = ['strict', 'strictNullChecks', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'verbatimModuleSyntax',
  'isolatedModules', 'isolatedDeclarations', 'erasableSyntaxOnly', 'declaration', 'emitDeclarationOnly', 'composite', 'noEmit', 'allowJs',
  'checkJs', 'target', 'module', 'moduleResolution', 'baseUrl', 'paths', 'types', 'rootDir', 'plugins', 'noUnusedLocals', 'downlevelIteration',
  'useUnknownInCatchVariables', 'experimentalDecorators', 'emitDecoratorMetadata', 'jsx', 'outDir', 'tsBuildInfoFile', 'lib'];

function resolveExtends(spec, fromFile, stopAt) {
  const fromDir = dirname(fromFile);
  const cands = [];
  if (spec.startsWith('.') || isAbsolute(spec)) {
    const p = resolve(fromDir, spec);
    cands.push(p, p + '.json', join(p, 'tsconfig.json'));
  } else {
    // bare specifier: node_modules lookup walking up
    const hit = walkUp(fromDir, (d) => {
      for (const c of [join(d, 'node_modules', spec), join(d, 'node_modules', spec + '.json'), join(d, 'node_modules', spec, 'tsconfig.json')]) {
        if (isFile(c)) return c;
      }
      return null;
    }, stopAt);
    if (hit) cands.push(hit.value);
  }
  return cands.find(isFile) || null;
}

/**
 * Read one tsconfig and merge its `extends` chain.
 * -> { file, chain[], options (merged compilerOptions), include, exclude, files, references[], unresolved_extends[], parse_error }
 */
export function readTsconfig(file, { stopAt = null } = {}) {
  const unresolved = [];
  const chain = [];
  const seen = new Set();
  const load = (f, depth) => {
    if (depth > MAX_DEPTH || seen.has(f)) return null;
    seen.add(f);
    const r = readJsonc(f);
    if (!r.ok || !r.value || typeof r.value !== 'object') return { error: r.error || 'not an object', file: f };
    const cfg = r.value;
    let merged = { options: {}, include: undefined, exclude: undefined, files: undefined };
    const exts = cfg.extends === undefined ? [] : Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends];
    for (const e of exts) {
      if (typeof e !== 'string') continue;
      const target = resolveExtends(e, f, stopAt);
      if (!target) { unresolved.push({ from: f, spec: e }); continue; }
      const base = load(target, depth + 1);
      if (!base || base.error) continue;
      merged = {
        options: { ...merged.options, ...base.options },
        include: base.include ?? merged.include, exclude: base.exclude ?? merged.exclude, files: base.files ?? merged.files,
      };
    }
    chain.push(f);
    return {
      options: { ...merged.options, ...(cfg.compilerOptions || {}) },
      include: cfg.include ?? merged.include, exclude: cfg.exclude ?? merged.exclude, files: cfg.files ?? merged.files,
      references: Array.isArray(cfg.references) ? cfg.references : undefined,
      extends: exts,
    };
  };
  const top = load(file, 0);
  if (!top || top.error) return { file, chain, options: {}, include: undefined, exclude: undefined, files: undefined, references: [], unresolved_extends: unresolved, parse_error: top?.error || 'unreadable' };
  return {
    file, chain, options: top.options, include: top.include, exclude: top.exclude, files: top.files,
    references: (top.references || []).map((r) => (typeof r?.path === 'string' ? r.path : null)).filter(Boolean),
    extends: top.extends, unresolved_extends: unresolved, parse_error: null,
  };
}

export function signalsOf(options) {
  const s = {};
  for (const k of SIGNAL_KEYS) s[k] = options[k] === undefined ? null : options[k];
  // `strict` implies strictNullChecks unless overridden: record the effective value alongside, keep raw keys
  if (s.strictNullChecks === null && s.strict !== null) s.strictNullChecks = !!s.strict;
  return s;
}

const TOOLING_NAME = /\.(node|vite|eslint|storybook|cypress|vitest|jest)\.json$/;

/** Classify configs of a package. `configs` = [{file(abs), rel, cfg}] */
export function classify(configs, pkgDir) {
  const extendedBy = new Set();
  const referenced = new Set();
  for (const c of configs) {
    for (const e of c.cfg.extends || []) if (typeof e === 'string' && (e.startsWith('.') || isAbsolute(e))) {
      const p = resolve(dirname(c.file), e);
      for (const cand of [p, p + '.json', join(p, 'tsconfig.json')]) extendedBy.add(cand);
    }
    for (const r of c.cfg.references) {
      const p = resolve(dirname(c.file), r);
      referenced.add(p); referenced.add(join(p, 'tsconfig.json')); referenced.add(p + '.json');
    }
  }
  return configs.map((c) => {
    const noFiles = !c.cfg.files || c.cfg.files.length === 0;
    const hasInclude = c.cfg.include !== undefined;
    let cls;
    if (c.cfg.references.length > 0 && noFiles && (!hasInclude || (Array.isArray(c.cfg.include) && c.cfg.include.length === 0))) cls = 'solution';
    else if (TOOLING_NAME.test(basename(c.file))) cls = 'tooling';
    else if (extendedBy.has(c.file) && !referenced.has(c.file) && !hasInclude && noFiles) cls = 'base';
    else cls = 'project';
    return { ...c, class: cls };
  });
}

export function rel(root, p) { return toPosix(relative(root, p)) || '.'; }
