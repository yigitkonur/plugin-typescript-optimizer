// Catalog loader: rule files (front matter + sections) and JSON data tables. Cached per process.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from '../core/home.mjs';
import { trySplitFrontMatter } from '../core/yaml-subset.mjs';
import { readJsonc } from '../core/fs.mjs';

export const CATALOG_DIR = join(PLUGIN_ROOT, 'catalog');
let rulesCache = null;
const jsonCache = new Map();

export const DOMAIN_ORDER = ['platform', 'reachability', 'types', 'structure', 'slop', 'toolchain'];
export const WAVE_ORDER = ['R0', 'R', '1', '2', '3', 'B', '4', '5', 'P', 'T1', 'T2', 'T3', 'T4'];

function sections(body) {
  const out = {};
  let cur = null;
  for (const line of body.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { cur = m[1].toLowerCase(); out[cur] = []; } else if (cur) out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

export function loadRules(dir = join(CATALOG_DIR, 'rules')) {
  if (rulesCache && dir === join(CATALOG_DIR, 'rules')) return rulesCache;
  const map = new Map();
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { /* no catalog dir */ }
  for (const f of names) {
    const r = trySplitFrontMatter(readFileSync(join(dir, f), 'utf8'));
    if (!r.ok || !r.data || !r.data.id) continue;
    const meta = r.data;
    map.set(meta.id, { ...meta, tells: meta.tells || [], modes: meta.modes || [], engines: meta.engines || [], file: f, sections: sections(r.body || '') });
  }
  if (dir === join(CATALOG_DIR, 'rules')) rulesCache = map;
  return map;
}

export function ruleList() { return [...loadRules().values()]; }

/** rules active for a mode/domain selection, in catalog order (domain, then id) */
export function selectRules({ mode = 'standard', domains = null } = {}) {
  return ruleList().filter((r) => r.modes.includes(mode) && (!domains || domains.includes(r.domain)))
    .sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.id.localeCompare(b.id));
}

export function catalogJson(name) {
  if (jsonCache.has(name)) return jsonCache.get(name);
  const r = readJsonc(join(CATALOG_DIR, name));
  const v = r.ok ? r.value : null;
  jsonCache.set(name, v);
  return v;
}
