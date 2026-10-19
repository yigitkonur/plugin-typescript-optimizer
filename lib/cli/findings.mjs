// ts-opt findings ingest|list|show
import { join } from 'node:path';
import { readFinding } from '../artifacts/finding.mjs';
import { ingest } from '../artifacts/ingest.mjs';
import { loadConfig } from '../artifacts/config.mjs';
import { readRun, resolveRunId, runDir } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { readJsonc } from '../core/fs.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';

export const spec = { wave: 'string', state: 'string', rule: 'string', domain: 'string' };

export async function run({ cwd, flags, args }) {
  const sub = args[0];
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  if (sub === 'ingest') {
    const runObj = readRun(root, id);
    if (!['scanning', 'triaging', 'planned'].includes(runObj.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${runObj.state}; ingest only works before the plan is locked`);
    const d = await detect(root);
    const { config } = loadConfig(root);
    const r = ingest({ root, runId: id, detect: d, run: runObj, config, mode: runObj.mode });
    return { result: r, text: `${r.findings} findings (${r.by_severity.hard} hard · ${r.by_severity.warn} warn · ${r.by_severity.advisory} advisory), ${r.eligible} eligible for approval, ${r.dismissed} dismissed, ${r.suppressed} suppressed, ${r.superseded} superseded, ${r.overflow} over cap\nneeds your decision: ${r.needs_decision}\n${r.summary}\n${r.plan}`, next_actions: [{ cmd: 'ts-opt validate', why: 'check the generated artifacts' }] };
  }
  const index = readJsonc(join(runDir(root, id), 'findings', 'index.json'));
  if (!index.ok) throw new TsOptError(EXIT.NOTHING, `run ${id} has no findings yet (run \`ts-opt findings ingest\`)`);
  if (sub === 'list') {
    let list = index.value.findings;
    if (flags.wave) list = list.filter((f) => String(f.wave) === flags.wave);
    if (flags.state) list = list.filter((f) => f.state === flags.state);
    if (flags.rule) list = list.filter((f) => f.rule === flags.rule);
    if (flags.domain) list = list.filter((f) => f.domain === flags.domain);
    return { result: { findings: list }, text: list.map((f) => `${f.id} ${f.rule.padEnd(9)} wave ${String(f.wave).padEnd(4)} ${f.severity.padEnd(8)} ${f.fix_risk.padEnd(6)} ${f.state.padEnd(10)} ${f.file}:${f.line}`).join('\n') || '(none)' };
  }
  if (sub === 'show') {
    const fid = args[1];
    if (!fid) throw new TsOptError(EXIT.USAGE, 'usage: ts-opt findings show F-0001');
    const fp = join(runDir(root, id), 'findings', `${fid}.md`);
    let f; try { f = readFinding(fp); } catch { throw new TsOptError(EXIT.NOTHING, `no finding ${fid}`); }
    return { result: { front: f.front, sections: f.sections }, text: f.body };
  }
  throw new TsOptError(EXIT.USAGE, 'usage: ts-opt findings ingest|list|show');
}
