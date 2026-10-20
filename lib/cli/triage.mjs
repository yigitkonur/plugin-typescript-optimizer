// ts-opt triage plan: chunk the candidates that need reading (doc 02 §3.2, doc 04 §12).
import { join } from 'node:path';
import { readCandidates } from '../artifacts/candidates.mjs';
import { resolveRunId, runDir } from '../artifacts/store.mjs';
import { loadRules } from '../catalog/index.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { mkdirp, writeAtomic } from '../core/fs.mjs';
import { findRoot } from '../detect/root.mjs';
import { frameworkEntryGlobs, protectedPaths } from '../detect/packs.mjs';
import { detect } from '../detect/index.mjs';
import { readdirSync, rmSync } from 'node:fs';
import { loadConfig } from '../artifacts/config.mjs';
import { readRun } from '../artifacts/store.mjs';
import { planStructure, writeChurn, writeStructureChunks } from '../artifacts/structure-plan.mjs';

export const spec = { kind: 'string', 'chunk-size': 'number' };

/** what a triager needs to start reading: raw/ is gitignored and hidden, so rg from the subagent's guard cannot look candidates up itself */
const record = (c) => ({
  id: c.id, rule: c.rule, file: c.file, line: c.line, symbol: c.symbol ?? null, grain: c.grain, engine: c.engine, path_class: c.path_class, fix_risk_hint: c.fix_risk_hint,
  ...(c.tell ? { tell: c.tell } : {}), ...(c.sub ? { sub: c.sub } : {}),
  consumers: (c.consumers || []).slice(0, 8), snippet: String(c.snippet ?? '').slice(0, 400),
});

export async function run({ cwd, flags, args }) {
  if (args[0] !== 'plan') throw new TsOptError(EXIT.USAGE, 'usage: ts-opt triage plan [--kind verify|structure] [--chunk-size N]');
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  const kind = flags.kind || 'verify';
  const size = flags['chunk-size'] || 8; // measured: ~3-5 tool calls per candidate, maxTurns 60 (doc 10 row 2.11)
  const d = await detect(root);
  if (kind === 'structure') {
    const run = readRun(root, id);
    if (run.mode !== 'deep') throw new TsOptError(EXIT.PRECONDITION, `run ${id} is a ${run.mode} audit; structure proposals belong to deep mode`, 'run `/ts-optimize:audit --mode deep`');
    const { config } = loadConfig(root);
    const plan = await planStructure({ root, runId: id, detect: d, config, run, max: config.thresholds?.max_architect_modules ?? 36 });
    const ctx = { packs: d.packs.map((p) => p.name), frameworks: d.frameworks, protected: (() => { try { return protectedPaths(root, d); } catch { return []; } })().slice(0, 60), entry_conventions: (frameworkEntryGlobs(d.frameworks).entry || []).slice(0, 60) };
    const chunks = writeStructureChunks({ root, runId: id, plan, context: ctx });
    writeChurn(root, id, plan);
    return {
      result: { chunks, groups: plan.groups.map((g) => ({ id: g.id, package: g.package, modules: g.modules.map((m) => m.file) })), window: plan.window, shallow: plan.shallow, cold_excluded: plan.cold },
      text: chunks.length ? `${chunks.map((c) => `${c.id} ${c.package} ${c.modules} module(s) → ${c.path}`).join('\n')}\nchurn window: ${plan.window || 'unavailable (no git history)'}; ${plan.cold} cold module(s) excluded` : `no hot modules in the churn window (${plan.window}); ${plan.cold} cold module(s) excluded`,
    };
  }
  const rules = loadRules();
  const prot = (() => { try { return protectedPaths(root, d); } catch { return []; } })();
  const entries = frameworkEntryGlobs(d.frameworks).entry || [];
  const cands = readCandidates(root, id).filter((c) => c.triage !== 'deterministic');
  const groups = new Map();
  for (const c of cands) { const k = `${c.domain}\0${c.package}`; (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const dir = join(runDir(root, id), 'raw', 'chunks');
  mkdirp(dir);
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  const chunks = [];
  let n = 0;
  for (const [k, list] of [...groups.entries()].sort()) {
    const [domain, pkg] = k.split('\0');
    for (let i = 0; i < list.length; i += size) {
      const part = list.slice(i, i + size);
      const cid = `C${String(++n).padStart(2, '0')}`;
      const ruleNotes = {};
      for (const r of new Set(part.map((c) => c.rule))) { const t = rules.get(r)?.sections?.triage; if (t) ruleNotes[r] = t.split('\n').slice(0, 6).join('\n').slice(0, 600); }
      const chunk = {
        schema: 'ts-optimize/chunk@1', id: cid, run: id, domain, package: pkg, candidates: part.map((c) => c.id), records: part.map(record),
        context: { packs: d.packs.map((p) => p.name), frameworks: d.frameworks, protected: prot.slice(0, 60), entry_conventions: entries.slice(0, 60), rule_notes: ruleNotes },
        protocol: 'skills/audit/references/triage-protocol.md',
      };
      writeAtomic(join(dir, `${cid}.json`), JSON.stringify(chunk, null, 2) + '\n');
      chunks.push({ id: cid, path: `.ts-optimize/runs/${id}/raw/chunks/${cid}.json`, domain, package: pkg, candidates: part.length });
    }
  }
  return { result: { chunks, groups: [] }, text: chunks.length ? chunks.map((c) => `${c.id} ${c.domain}/${c.package} ${c.candidates} candidates → ${c.path}`).join('\n') : 'no candidates need reading' };
}
