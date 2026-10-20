// Knip adapter (doc 06 §12): the unused set from `knip --reporter json`; v5 and v6 JSON shapes; default + production + cycles passes.
// Knip supplies *what is unused*; consumers/touches come from the importer index, not from Knip.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ART } from '../artifacts/store.mjs';
import { run as runProc } from '../core/proc.mjs';
import { isFile, readJsonc } from '../core/fs.mjs';
import { log } from '../core/log.mjs';
import { packageOf } from '../detect/classify.mjs';
import { maskSource } from './mask.mjs';

export const name = 'knip';
const KNIP_RULES = new Set(['reach-01', 'reach-02', 'reach-03', 'reach-04', 'reach-05', 'reach-07', 'reach-08', 'reach-09', 'reach-12', 'struct-02']);
export const handles = (rule) => /^knip:/.test(String(rule.adapter || '')) || rule.id === 'reach-12' || (rule.id === 'struct-02' && /^graph:/.test(String(rule.adapter || '')));
export function available(d) {
  if (d.packages.length && d.packages.every((p) => p.kind === 'deno')) return { ok: false, reason: 'Deno project: Node-based engines (Knip) are skipped; `deno check` is the typecheck' };
  const k = d.engines?.knip;
  return k && k.works ? { ok: true } : { ok: false, reason: k && k.reason !== 'absent' ? `Knip unusable (${k.reason})` : 'Knip not found: allow the toolbox or add knip to the project' };
}

/** Knip roots: the repo root when it has a package.json (Knip finds the workspaces itself), else each top-level TS package (polyglot repos, F06-style layouts) */
export function knipRoots(root, d) {
  if (isFile(join(root, 'package.json'))) return ['.'];
  const pk = d.packages.filter((p) => p.has_package_json && p.kind === 'node' && !p.root_only).map((p) => p.path).sort();
  return pk.filter((p) => !pk.some((q) => q !== p && p.startsWith(q + '/')));
}

const USER_CONFIG = ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.ts', 'knip.js', 'knip.config.ts', 'knip.config.js'];
function hasUserConfig(root) {
  if (USER_CONFIG.some((f) => isFile(join(root, f)))) return true;
  const pj = readJsonc(join(root, 'package.json'));
  return !!(pj.ok && pj.value && pj.value.knip);
}
const toArray = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.entries(x).map(([k, v]) => (v && typeof v === 'object' ? { name: k, ...v } : { name: k })) : []);

/** Normalise v5/v6 JSON into [{type, file, name, line, col, extra}] */
export function normalizeKnip(json) {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json.files)) for (const f of json.files) out.push({ type: 'files', file: typeof f === 'string' ? f : f.name, name: null, line: 1, col: 1 }); // v5 root `files`
  for (const rec of json.issues || []) {
    const file = rec.file;
    for (const [type, val] of Object.entries(rec)) {
      if (type === 'file') continue;
      if (type === 'cycles') { for (const cyc of val || []) out.push({ type: 'cycles', file, cycle: cyc, line: cyc[0]?.line ?? 1, col: cyc[0]?.col ?? 1, name: null }); continue; }
      if (type === 'files') { if (Array.isArray(val) && val.length) out.push({ type: 'files', file, name: null, line: 1, col: 1 }); continue; }
      for (const e of toArray(val)) out.push({ type, file, name: e.name ?? e.symbol ?? null, line: e.line ?? 1, col: e.col ?? 1, extra: e });
    }
  }
  return out;
}

async function runKnip(bin, cwd, extra, timeoutMs) {
  const r = await runProc([bin, '--reporter', 'json', '--no-config-hints', '--no-exit-code', ...extra], { cwd, timeoutMs, maxBytes: 128 * 1024 * 1024 });
  if (r.timedOut) return { ok: false, reason: `Knip timed out after ${timeoutMs / 1000}s` };
  const start = r.stdout.indexOf('{');
  if (start < 0) return { ok: false, reason: `Knip produced no JSON (exit ${r.code}): ${(r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 200)}` };
  try { return { ok: true, json: JSON.parse(r.stdout.slice(start)), ms: r.ms }; } catch (e) { return { ok: false, reason: `Knip JSON unparsable: ${e.message}` }; }
}

/** barrel = majority of top-level statements are re-exports (not decided by the file name) */
export function isBarrelText(text) {
  const code = maskSource(text).code;
  const re = (code.match(/^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\b/gm) || []).length;
  if (!re) return false;
  const other = (code.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|enum|abstract\s+class)\b|^(?:export\s+)?type\s+\w+\s*(?:<[^>]*>)?\s*=/gm) || []).length;
  return re > other;
}

export async function run(ctx) {
  const { root, detect: d, rules, config, runDir, scope } = ctx;
  const bin = d.engines.knip.bin;
  const version = d.engines.knip.version || '?';
  const want = new Set(rules.map((r) => r.id));
  const timeoutMs = (config.gate?.timeout_s?.typecheck || 600) * 1000;
  const overlay = join(root, ART, 'knip.config.jsonc');
  const cfgArgs = !hasUserConfig(root) && isFile(overlay) ? ['--config', overlay] : [];
  const notes = { version, passes: [] };
  const cands = [];
  const degraded = [];

  const roots = knipRoots(root, d);
  const prefixed = (items, rp) => (rp === '.' ? items : items.map((i) => ({ ...i, file: join(rp, i.file).split('\\').join('/'), cycle: i.cycle ? i.cycle.map((e) => ({ ...e, name: join(rp, e.name).split('\\').join('/') })) : undefined })));
  const pass = async (label, extra) => {
    log(`[knip] ${label}`);
    const all = [];
    for (const rp of roots) {
      const cwd = rp === '.' ? root : join(root, rp);
      const r = await runKnip(bin, cwd, [...(rp === '.' ? cfgArgs : []), ...extra], timeoutMs);
      notes.passes.push({ label, root: rp, ok: r.ok, ms: r.ms ?? null, reason: r.reason ?? null });
      if (!r.ok) { if (roots.length === 1) return null; continue; }
      all.push(...prefixed(normalizeKnip(r.json), rp).filter((i) => !String(i.file || '').startsWith('.quarantine/'))); // parked files are not candidates
    }
    return roots.length && notes.passes.filter((p) => p.label === label).every((p) => !p.ok) ? null : all;
  };

  const needDefault = [...want].some((r) => r !== 'struct-02' && r !== 'reach-12');
  const def = needDefault ? await pass('default pass', ['--exclude', 'cycles']) : [];
  const prod = want.has('reach-03') && def ? await pass('production pass', ['--production', '--exclude', 'cycles,dependencies,unlisted,binaries,unresolved,catalog,catalogReferences']) : null;
  const cyc = want.has('struct-02') ? await pass('cycles', ['--cycles']) : null;
  if (!def) { degraded.push({ domain: 'reachability', part: 'knip', reason: notes.passes.find((p) => !p.ok)?.reason || 'Knip failed' }); }

  const textCache = new Map();
  const readText = async (f) => { if (!textCache.has(f)) { try { textCache.set(f, await readFile(join(root, f), 'utf8')); } catch { textCache.set(f, ''); } } return textCache.get(f); };
  const lineText = async (f, n) => (await readText(f)).split('\n')[Math.max(0, n - 1)]?.trim().slice(0, 300) || '';
  const barrelCache = new Map();
  const isBarrel = async (f) => { if (!barrelCache.has(f)) barrelCache.set(f, isBarrelText(await readText(f))); return barrelCache.get(f); };
  const make = async (rule, i, extra = {}) => {
    const r = ctx.rules.find((x) => x.id === rule);
    const file = i.file;
    return {
      rule, domain: r.domain, engine: `knip@${version}:${i.type}`, package: packageOf(file, d.packages), file, line: i.line || 1, col: i.col || 1,
      symbol: i.name || null, grain: r.grain || 'symbol', snippet: i.type === 'files' ? (await readText(file)).split('\n').slice(0, 3).join('\n').slice(0, 300) : (i.type === 'dependencies' || i.type === 'devDependencies' ? i.name : await lineText(file, i.line)),
      raw_ref: `knip:${i.type}`, severity_hint: r.severity, batch: r.batch ?? null, wave: r.wave ?? null, fix_mode_hint: r.fix_mode, consumers: [], triage: r.triage || 'agent', path_class: 'source', ...extra,
    };
  };

  if (def) {
    const defExports = new Set(def.filter((i) => i.type === 'exports' || i.type === 'types').map((i) => `${i.file}\0${i.name}`));
    for (const i of def) {
      if (i.type === 'files' && want.has('reach-01')) cands.push(await make('reach-01', i));
      else if (i.type === 'exports') {
        if (await isBarrel(i.file)) { if (want.has('reach-02')) cands.push(await make('reach-02', i)); }
        else if (want.has('reach-04')) cands.push(await make('reach-04', i));
      } else if ((i.type === 'types' || i.type === 'enumMembers' || i.type === 'namespaceMembers') && want.has('reach-05')) cands.push(await make('reach-05', i, { symbol: i.name }));
      else if (i.type === 'duplicates' && want.has('reach-09')) cands.push(await make('reach-09', i));
      else if (['dependencies', 'devDependencies', 'optionalPeerDependencies'].includes(i.type) && want.has('reach-07')) cands.push(await make('reach-07', i, { file: i.file || 'package.json', package: packageOf(dirname(i.file || 'package.json') === '.' ? 'package.json' : i.file, d.packages) }));
      else if (['catalog'].includes(i.type) && want.has('reach-07')) cands.push(await make('reach-07', i));
      else if (['unlisted', 'unresolved', 'binaries'].includes(i.type) && want.has('reach-08')) cands.push(await make('reach-08', i));
    }
    if (prod) {
      const prodUnused = prod.filter((i) => i.type === 'exports' || i.type === 'types');
      for (const i of prodUnused) if (!defExports.has(`${i.file}\0${i.name}`)) cands.push(await make('reach-03', i, { path_class: 'source' }));
    }
  }
  if (cyc) {
    for (const i of cyc.filter((x) => x.type === 'cycles')) {
      const files = [...new Set(i.cycle.map((e) => e.name))];
      // the finding sits on the edge that closes the cycle (the sibling importing the barrel): that is the line a fix usually changes
      const closing = i.cycle[i.cycle.length - 1];
      const r = ctx.rules.find((x) => x.id === 'struct-02');
      cands.push({ rule: 'struct-02', domain: r.domain, engine: `knip@${version}:cycles`, package: packageOf(closing.name, d.packages), file: closing.name, line: closing.line || 1, col: closing.col || 1, symbol: null, grain: 'cycle', snippet: i.cycle.map((e) => `${e.name} -${e.kind}-> ${e.specifier}`).join('\n').slice(0, 400), raw_ref: 'knip:cycles', cycle: files, severity_hint: r.severity, batch: r.batch ?? 9, wave: r.wave ?? '2', fix_mode_hint: r.fix_mode, consumers: files.filter((f) => f !== closing.name), triage: r.triage || 'agent', path_class: 'source' });
    }
  }

  // noise gate (doc 06 §12.2): too much "unused" without a config means the config is the finding
  const unusedFiles = (def || []).filter((i) => i.type === 'files').length;
  const projectFiles = Math.max(1, scope.all_count);
  const pct = Math.round((unusedFiles / projectFiles) * 1000) / 10;
  const tripped = !!def && !hasUserConfig(root) && cfgArgs.length === 0 && pct > 25 && projectFiles >= 4;
  notes.noise_gate = { tripped, percent: pct, unused_files: unusedFiles, project_files: projectFiles };
  let out = cands;
  if (tripped && want.has('reach-12')) {
    const withheld = cands.filter((c) => ['reach-01', 'reach-02', 'reach-03', 'reach-04', 'reach-05', 'reach-09'].includes(c.rule));
    out = cands.filter((c) => !withheld.includes(c));
    const r = ctx.rules.find((x) => x.id === 'reach-12');
    out.push({ rule: 'reach-12', domain: r.domain, engine: `knip@${version}:noise-gate`, package: '.', file: 'package.json', line: 1, col: 1, symbol: null, grain: 'project', snippet: `Knip reports ${pct}% of project files (${unusedFiles}/${projectFiles}) as unused without a config`, raw_ref: 'knip:noise-gate', severity_hint: r.severity, batch: null, wave: r.wave ?? null, fix_mode_hint: 'flag-only', consumers: [], triage: 'deterministic', path_class: 'source' });
    notes.withheld = withheld.length;
    writeWithheld(runDir, withheld);
  }
  notes.degraded = degraded;
  return { candidates: out, notes };
}

import { writeFileSync } from 'node:fs';
function writeWithheld(runDir, list) { writeFileSync(join(runDir, 'raw', 'withheld.jsonl'), list.map((c) => JSON.stringify(c)).join('\n') + '\n'); }
