// `triage plan --kind structure` (deep mode): pick the hot modules for ts-architect and group them (doc 06 §7, doc 11 §8).
// YAGNI hot-spot scoping: a module nobody has touched in the churn window is never proposed.
import { join } from 'node:path';
import { readCandidates } from './candidates.mjs';
import { runDir } from './store.mjs';
import { mkdirp, readText, writeAtomic } from '../core/fs.mjs';
import { run as runProc } from '../core/proc.mjs';
import { pathClass } from '../detect/classify.mjs';
import { buildImporterIndex } from '../engines/importers.mjs';
import { collectFiles } from '../engines/scope.mjs';
import { readdirSync, rmSync } from 'node:fs';

export const CHURN_WINDOW = '6.months';
export const GROUP_MAX = 12;
const SHALLOW_COMMITS = 100;

/** -> { counts: Map<file, commits>, window, shallow } ; git failures give an empty map and `window: null` */
export async function churnCounts(root, { since = CHURN_WINDOW } = {}) {
  const sh = await runProc(['git', 'rev-parse', '--is-shallow-repository'], { cwd: root, timeoutMs: 10_000 });
  const shallow = sh.code === 0 && sh.stdout.trim() === 'true';
  const args = ['log', '--name-only', '--pretty=format:', '--no-renames', ...(shallow ? ['-n', String(SHALLOW_COMMITS)] : [`--since=${since}`])];
  const r = await runProc(['git', ...args], { cwd: root, timeoutMs: 60_000, maxBytes: 64 * 1024 * 1024 });
  const counts = new Map();
  if (r.code !== 0) return { counts, window: null, shallow };
  for (const f of r.stdout.split('\n')) if (f) counts.set(f, (counts.get(f) || 0) + 1);
  return { counts, window: shallow ? `last ${SHALLOW_COMMITS} commits (shallow clone)` : `since ${since.replace('.', ' ')}`, shallow };
}

const locOf = (text) => (text ? text.split('\n').length : 0);

/**
 * -> { window, modules:[{file, package, commits, loc, importers, imports, complexity, candidates:[{rule,line}]}], groups:[{id, package, modules:[…]}], cold }
 * modules are ranked by commits x (importers + 1) + complexity score; at most `max` are kept; groups keep directory neighbours together.
 */
export async function planStructure({ root, runId, detect, config, run, max = 36 }) {
  const scope = await collectFiles(root, { isGit: detect.git.repo, config, workspacePaths: run?.scope?.workspaces?.length ? run.scope.workspaces : null });
  const idx = await buildImporterIndex({ root, files: scope.all_files, packages: detect.packages });
  const { counts, window, shallow } = await churnCounts(root);
  let cands = [];
  try { cands = readCandidates(root, runId); } catch { /* no candidates yet */ }
  const byFile = new Map();
  for (const c of cands) (byFile.get(c.file) || byFile.set(c.file, []).get(c.file)).push({ rule: c.rule, line: c.line });
  const pkgOf = (f) => {
    let best = '.'; let len = -1;
    for (const p of detect.packages) if (p.path !== '.' && (f === p.path || f.startsWith(p.path + '/')) && p.path.length > len) { best = p.path; len = p.path.length; }
    return best;
  };
  const cold = []; const modules = [];
  for (const f of scope.files) {
    const cls = pathClass(f);
    if (cls === 'test' || cls === 'generated' || cls === 'fixture' || /\.d\.ts$/.test(f)) continue;
    const commits = counts.get(f) || 0;
    if (window && commits === 0) { cold.push(f); continue; } // hot spots only
    const importers = idx.importersOf(f);
    const cs = byFile.get(f) || [];
    const complexity = cs.filter((c) => c.rule === 'struct-09').length;
    const score = commits * (importers.length + 1) + complexity * 5 + cs.length;
    modules.push({ file: f, package: pkgOf(f), commits, loc: locOf(readText(join(root, f))), importers: importers.slice(0, 8), importer_count: importers.length, imports: idx.importsOf(f).slice(0, 8), complexity, candidates: cs.slice(0, 6), score });
  }
  modules.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const keep = modules.slice(0, max);
  // groups: same package, directory neighbours together, at most GROUP_MAX modules each
  const byPkg = new Map();
  for (const m of keep) (byPkg.get(m.package) || byPkg.set(m.package, []).get(m.package)).push(m);
  const groups = [];
  for (const [pkg, list] of [...byPkg.entries()].sort()) {
    list.sort((a, b) => a.file.localeCompare(b.file));
    for (let i = 0; i < list.length; i += GROUP_MAX) groups.push({ id: `S${String(groups.length + 1).padStart(2, '0')}`, package: pkg, modules: list.slice(i, i + GROUP_MAX) });
  }
  return { window, shallow, modules: keep, groups, cold: cold.length };
}

/** raw/churn.json: what codebase-health.md reports about the window and the hot spots */
export function writeChurn(root, runId, plan) {
  writeAtomic(join(runDir(root, runId), 'raw', 'churn.json'), JSON.stringify({ window: plan.window, shallow: plan.shallow, cold_excluded: plan.cold, hot: plan.modules.map((m) => ({ file: m.file, commits: m.commits, importer_count: m.importer_count, loc: m.loc, candidates: m.candidates })) }, null, 2) + '\n');
}

/** write raw/chunks/Snn.json files (schema ts-optimize/chunk@1, kind "structure") -> [{id, path, package, modules}] */
export function writeStructureChunks({ root, runId, plan, context }) {
  const dir = join(runDir(root, runId), 'raw', 'chunks');
  mkdirp(dir);
  for (const f of readdirSync(dir)) if (/^S\d+\.json$/.test(f)) rmSync(join(dir, f), { force: true });
  return plan.groups.map((g) => {
    const chunk = {
      schema: 'ts-optimize/chunk@1', id: g.id, kind: 'structure', run: runId, domain: 'structure', package: g.package, candidates: [],
      churn_window: plan.window, modules: g.modules,
      context: { ...context, rule_notes: { 'struct-03': 'passthrough wrapper', 'struct-04': 'phantom interface', 'struct-10': 'subsystem locality', 'struct-11': 'shallow module' } },
      protocol: 'references/structure-playbook.md',
    };
    writeAtomic(join(dir, `${g.id}.json`), JSON.stringify(chunk, null, 2) + '\n');
    return { id: g.id, path: `.ts-optimize/runs/${runId}/raw/chunks/${g.id}.json`, package: g.package, modules: g.modules.length };
  });
}
