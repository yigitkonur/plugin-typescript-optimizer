// ts-opt scan: run engines + tier-1 tells, write raw/candidates.jsonl, create the run (doc 02 §3.2, doc 04 §2, §4).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { fingerprintOf } from '../artifacts/fingerprint.mjs';
import { ART, OPEN_STATES, clearOpenRun, ensureArtifactRoot, listRuns, newRunId, openRunId, readRun, runDir, writeRun } from '../artifacts/store.mjs';
import { DOMAIN_ORDER, selectRules } from '../catalog/index.mjs';
import { nowIso } from '../core/clock.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isDir, isFile, mkdirp, readJsonc, writeAtomic } from '../core/fs.mjs';
import { log } from '../core/log.mjs';
import { PLUGIN_ROOT } from '../core/home.mjs';
import { detect } from '../detect/index.mjs';
import { SFC_EXT } from '../detect/classify.mjs';
import { ENGINES } from '../engines/index.mjs';
import { buildImporterIndex } from '../engines/importers.mjs';
import { resolveLegs } from '../gate/legs.mjs';
import { refineCandidates } from '../engines/refine.mjs';
import { collectFiles, defaultBranch } from '../engines/scope.mjs';
import { pluginVersion } from './main.mjs';

export const spec = { mode: 'string', domains: 'array', diff: 'optional', workspace: 'string', resume: 'string', 'abandon-open': 'boolean', 'rescan-engine': 'string' };
const MODES = ['sweep', 'standard', 'deep', 'tsgo'];

function suppressionsFor(root) {
  const f = join(root, ART, 'suppressions.json');
  if (!isFile(f)) return new Map();
  const r = readJsonc(f);
  const today = nowIso().slice(0, 10);
  const m = new Map();
  if (r.ok) for (const e of r.value.entries || []) if (!e.expires || e.expires >= today) m.set(e.fingerprint, e);
  return m;
}

function snapshotEnv(d) {
  const c = d.compilers;
  return {
    node: process.versions.node, os: `${process.platform}-${process.arch}`,
    pm: d.pm && { name: d.pm.name, version: d.pm.version, source: d.pm.source },
    packages: d.packages.filter((p) => !p.root_only).map((p) => ({ path: p.path, name: p.name })),
    compilers: c && { authoritative: c.authoritative && { bin: c.authoritative.bin, version: c.authoritative.version, kind: c.authoritative.kind }, fast: c.fast && { bin: c.fast.bin, version: c.fast.version, kind: c.fast.kind }, api_provider: c.api_provider && { version: c.api_provider.version } },
    engines: { ...Object.fromEntries(Object.entries(d.engines).map(([n, e]) => [n, { version: e.version, source: e.source, works: e.works, ...(e.works ? {} : { reason: e.reason }) }])), lint: d.lint?.engine ? { engine: d.lint.engine } : { engine: null } },
    packs: d.packs.map((p) => p.name), frameworks: d.frameworks,
  };
}

export async function run({ cwd, flags }) {
  const t0 = Date.now();
  const mode = flags.mode || 'standard';
  if (!MODES.includes(mode)) throw new TsOptError(EXIT.USAGE, `unknown mode "${mode}" (sweep|standard|deep|tsgo)`);
  const domains = flags.domains || null;
  if (domains) for (const x of domains) if (!DOMAIN_ORDER.includes(x)) throw new TsOptError(EXIT.USAGE, `unknown domain "${x}" (${DOMAIN_ORDER.join(', ')})`);

  const d = await detect(cwd);
  if (!d.typescript) throw new TsOptError(EXIT.NOTHING, `No TypeScript found under ${d.root}; nothing to do.`);
  const root = d.root;
  const { config, warnings: cfgWarn } = loadConfig(root);
  const warnings = [...cfgWarn];

  // refuse while another run is open
  const open = openRunId(root);
  if (open && !flags.resume) {
    let st = null; try { st = readRun(root, open).state; } catch { /* unreadable run */ }
    if (st && OPEN_STATES.has(st)) {
      if (!flags['abandon-open']) throw new TsOptError(EXIT.PRECONDITION, `run ${open} is open (state ${st})`, 'finish it with /ts-optimize:fix, or pass --abandon-open to supersede it');
      const old = readRun(root, open); old.state = 'aborted'; old.abort_reason = 'superseded'; writeRun(root, old); clearOpenRun(root);
    }
  }

  ensureArtifactRoot(root);
  let run;
  if (flags.resume) {
    run = readRun(root, flags.resume);
    if (run.state !== 'scanning') throw new TsOptError(EXIT.PRECONDITION, `run ${run.id} is ${run.state}; only a "scanning" run can be resumed`);
  } else {
    const id = newRunId(root);
    const db = (await defaultBranch(root)) || d.git.branch;
    run = {
      schema: 'ts-optimize/run@1', id, plugin_version: pluginVersion(), state: 'scanning', mode, created: nowIso(),
      repo: { root, git: d.git.repo, head: d.git.head, branch: d.git.branch, dirty: d.git.clean === false, default_branch: db ? db.replace(/^origin\//, '') : null },
      env: snapshotEnv(d),
      scope: { workspaces: [], include: config.scope.include, exclude: config.scope.exclude, diff_base: null },
      domains: { run: [], degraded: [], skipped: [] },
      gate: { legs: resolveLegs(d, config), unavailable: d.gate.unavailable, baseline_status: 'unknown', red_baseline: null, accepted_risk: null },
      fast_check: { enabled: !!d.compilers?.fast, engine: d.compilers?.fast?.kind ?? null, baseline_ms: null, disabled_reason: d.compilers?.fast ? null : 'no fast compiler', divergences: 0 },
      waves: [], approvals: null, applying: null, timings_s: {}, commands: [],
    };
    mkdirp(join(runDir(root, id), 'raw', '.done'));
    mkdirp(join(runDir(root, id), 'findings'));
    writeRun(root, run);
  }
  const rd = runDir(root, run.id);
  mkdirp(join(rd, 'raw', '.done'));

  // scope
  let wsPaths = null;
  if (flags.workspace) {
    const ws = flags.workspace.replace(/^\.\//, '').replace(/\/$/, '');
    const hit = d.packages.filter((p) => p.path === ws || p.name === ws || p.path.endsWith('/' + ws));
    if (hit.length) wsPaths = hit.map((p) => p.path);
    else if (isDir(join(root, ws))) wsPaths = [ws]; // any directory inside the repo scopes the audit
    else throw new TsOptError(EXIT.USAGE, `unknown workspace or path "${flags.workspace}"`, `packages: ${d.packages.map((p) => p.path).join(', ')}`);
    run.scope.workspaces = wsPaths;
  }
  const scope = await collectFiles(root, { isGit: d.git.repo, config, workspacePaths: wsPaths, diff: flags.diff ?? null });
  warnings.push(...scope.warnings);
  if (scope.diff) run.scope.diff_base = scope.diff.base;
  writeAtomic(join(rd, 'raw', 'scope.json'), JSON.stringify({ files: scope.files.length, all: scope.all_count, diff: scope.diff, workspaces: wsPaths }, null, 2));

  // rule selection + engine dispatch
  let rules = selectRules({ mode, domains });
  if (scope.diff) rules = rules.filter((r) => !(r.domain === 'reachability' && r.adapter && /^knip:/.test(String(r.adapter)))); // a diff cannot prove death
  const degraded = [];
  const candidatesAll = [];
  const engineNotes = {};
  let noiseGate = { tripped: false, percent: null };
  const replacesTells = new Set();
  const metrics = [];
  for (const eng of ENGINES) {
    const mine = rules.filter((r) => eng.handles(r));
    if (!mine.length) continue;
    if (flags['rescan-engine'] && flags['rescan-engine'] !== eng.name) continue;
    const marker = join(rd, 'raw', '.done', eng.name);
    const partial = join(rd, 'raw', `cand-${eng.name}.jsonl`);
    const av = eng.available(d);
    if (!av.ok) { for (const r of mine) degraded.push({ domain: r.domain, part: r.id, reason: av.reason }); continue; }
    if (existsSync(marker) && existsSync(partial)) {
      log(`[scan] ${eng.name}: reusing finished output`);
      for (const l of readFileSync(partial, 'utf8').split('\n')) if (l) candidatesAll.push(JSON.parse(l));
      continue;
    }
    log(`[scan] ${eng.name}: ${mine.length} rules over ${scope.files.length} files`);
    const t1 = Date.now();
    const out = await eng.run({ root, detect: d, rules: mine, files: scope.files, config, mode, runDir: rd, scope });
    writeAtomic(partial, out.candidates.map((c) => JSON.stringify(c)).join('\n') + (out.candidates.length ? '\n' : ''));
    writeFileSync(marker, nowIso() + '\n');
    engineNotes[eng.name] = { ms: Date.now() - t1, ...(out.notes || {}) };
    if (out.notes?.noise_gate) noiseGate = out.notes.noise_gate;
    if (out.notes?.metric) metrics.push(out.notes.metric);
    if (out.notes?.degraded) degraded.push(...out.notes.degraded);
    if (out.notes?.replaces_tells_for) for (const rid of out.notes.replaces_tells_for) replacesTells.add(rid);
    for (const f of out.notes?.failed || []) degraded.push({ domain: 'structure', part: eng.name, reason: f });
    candidatesAll.push(...out.candidates);
  }
  if (replacesTells.size) {
    // ast-grep ran for these rules: its matches replace the regex candidates (regex is the broad generator, ast-grep the precision tier)
    for (let i = candidatesAll.length - 1; i >= 0; i--) if (replacesTells.has(candidatesAll[i].rule) && candidatesAll[i].engine.startsWith('tells:') && !SFC_EXT.test(candidatesAll[i].file)) candidatesAll.splice(i, 1); // ast-grep cannot parse .vue/.svelte/.astro: those keep the regex tier
  }
  const needsStructure = new Set(rules.filter((r) => Array.isArray(r.astgrep) && r.astgrep.length).map((r) => r.id));
  for (const c of candidatesAll) if (needsStructure.has(c.rule) && (!replacesTells.has(c.rule) || SFC_EXT.test(c.file))) c.tier_degraded = true; // regex only: confidence capped at "likely"
  // adapters that act at fix time (wave B creates reach-06 itself) are not audit-time degradations
  const FIX_TIME = new Set(['lint+tsc:unused-locals']);
  const unhandled = rules.filter((r) => !ENGINES.some((e) => e.handles(r)) && !FIX_TIME.has(String(r.adapter || '')));
  for (const r of unhandled) degraded.push({ domain: r.domain, part: r.id, reason: `no engine for ${r.adapter || r.engines?.join('')} yet` });

  candidatesAll.splice(0, candidatesAll.length, ...(await refineCandidates(candidatesAll, { root, allFiles: scope.all_files })));

  // consumers (who must change together with the finding) come from the importer index, never from Knip
  const needsIndex = candidatesAll.some((c) => ['reach-01', 'reach-02', 'reach-03', 'reach-04', 'reach-05', 'reach-09'].includes(c.rule));
  if (needsIndex) {
    const idx = await buildImporterIndex({ root, files: scope.all_files, packages: d.packages });
    for (const c of candidatesAll) {
      if (!['reach-01', 'reach-02', 'reach-03', 'reach-04', 'reach-05', 'reach-09'].includes(c.rule)) continue;
      const list = c.symbol ? idx.consumersOfSymbol(c.file, c.symbol) : idx.importersOf(c.file);
      c.consumers = list.filter((f) => f !== c.file);
    }
  }

  // deterministic order, ids, fingerprints, suppression filter
  const sup = suppressionsFor(root);
  const dIdx = (x) => DOMAIN_ORDER.indexOf(x.domain);
  candidatesAll.sort((a, b) => dIdx(a) - dIdx(b) || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
  let suppressed = 0; const kept = []; const suppressedList = [];
  for (const c of candidatesAll) {
    c.fingerprint = fingerprintOf(c);
    const s = sup.get(c.fingerprint);
    if (s) { suppressed++; suppressedList.push({ fingerprint: c.fingerprint, rule: c.rule, file: c.file, suppression: s.id }); continue; }
    kept.push(c);
  }
  kept.forEach((c, i) => { c.id = `c-${String(i + 1).padStart(4, '0')}`; });
  writeAtomic(join(rd, 'raw', 'candidates.jsonl'), kept.map((c) => JSON.stringify({ schema: 'ts-optimize/candidate@1', ...c })).join('\n') + (kept.length ? '\n' : ''));
  writeAtomic(join(rd, 'raw', 'suppressed.json'), JSON.stringify(suppressedList, null, 2));
  writeAtomic(join(rd, 'raw', 'metrics.json'), JSON.stringify(metrics, null, 2));

  const byDomain = {}; const byRule = {}; const tri = { deterministic: 0, agent: 0 };
  for (const c of kept) { byDomain[c.domain] = (byDomain[c.domain] || 0) + 1; byRule[c.rule] = (byRule[c.rule] || 0) + 1; tri[c.triage === 'deterministic' ? 'deterministic' : 'agent']++; }
  run.domains = { run: [...new Set(rules.map((r) => r.domain))], degraded, skipped: [] };
  run.timings_s = { ...run.timings_s, scan: Math.round((Date.now() - t0) / 100) / 10 };
  writeRun(root, run);

  const text = [`run ${run.id} (${mode}): ${kept.length} candidates from ${scope.files.length} files in ${run.timings_s.scan}s`,
    ...Object.entries(byDomain).map(([k, v]) => `  ${k.padEnd(13)} ${v}`),
    `triage: ${tri.agent} need reading, ${tri.deterministic} deterministic`, ...(suppressed ? [`suppressed before triage: ${suppressed}`] : []),
    ...degraded.map((x) => `degraded: [${x.domain}] ${x.part}: ${x.reason}`)].join('\n');
  return {
    result: { run: run.id, mode, counts: { total: kept.length, by_domain: byDomain, by_rule: byRule }, noise_gate: noiseGate, degraded, suppressed, candidates: `${ART}/runs/${run.id}/raw/candidates.jsonl`, triage: tri, files: scope.files.length, diff: scope.diff, engines: engineNotes },
    text, warnings, next_actions: [{ cmd: 'ts-opt triage plan', why: kept.length > 40 ? 'more than 40 candidates need reading: chunk them for ts-triager' : 'judge the candidates yourself with ts-opt verdict add, then ts-opt findings ingest' }],
  };
}
export { PLUGIN_ROOT, listRuns };
