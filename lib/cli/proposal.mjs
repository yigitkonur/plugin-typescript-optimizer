// ts-opt proposal add --origin fixer|architect …: record a new finding discovered mid-run or by ts-architect (doc 04 §12).
import { addFinding } from '../artifacts/newfinding.mjs';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile } from '../core/fs.mjs';
import { loadRules } from '../catalog/index.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { join, resolve, sep } from 'node:path';
import { readFileSync } from 'node:fs';

export const spec = { origin: 'string', parent: 'string', reason: 'string', rule: 'string', file: 'string', line: 'number', recommendation: 'string', 'deletion-test': 'string', 'seam-test': 'string', touch: 'multi', 'plan-step': 'multi', 'mermaid-file': 'string' };

export async function run({ cwd, flags, args }) {
  if (args[0] !== 'add') throw new TsOptError(EXIT.USAGE, 'usage: ts-opt proposal add --origin fixer --parent F-0007 --reason "…" --touch <path> | --origin architect --rule struct-03 --file … --line … --recommendation STRONG --deletion-test "…" --seam-test "…" --touch …');
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  const run = readRun(root, id);
  if (!['planned', 'ready', 'locked', 'applying', 'verifying'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}`);
  const d = await detect(root);
  const touches = [];
  for (const t of flags.touch || []) {
    const abs = resolve(root, t);
    if (abs !== root && !abs.startsWith(root + sep)) throw new TsOptError(EXIT.USAGE, `--touch ${t} is outside the repository`);
    if (!isFile(abs)) throw new TsOptError(EXIT.USAGE, `--touch ${t} does not exist`);
    touches.push(t.split(sep).join('/'));
  }
  if (flags.origin === 'fixer') {
    if (!flags.parent || !flags.reason || !touches.length) throw new TsOptError(EXIT.USAGE, '--origin fixer needs --parent F-…, --reason and at least one --touch');
    const parent = getFinding(root, id, flags.parent).front;
    const front = addFinding({ root, runId: id, detect: d, cand: { rule: parent.rule, file: touches[0], line: 1, package: parent.package, engine: 'proposal:fixer', snippet: '', fingerprint: null }, origin: `fixer:${parent.id}`, wave: parent.wave, touches, reason: flags.reason, evidence: [`discovered while applying ${parent.id}: ${flags.reason}`], fixMode: 'assisted' });
    stampLog(root, id, { ev: 'amend', ids: [front.id], by: 'fixer-proposal' });
    return { result: { id: front.id, origin: front.origin, wave: front.wave, touches: front.touches, state: front.state }, text: `proposed ${front.id} (${front.origin}, wave ${front.wave}, touches ${front.touches.join(', ')}); it needs the user's approval: ts-opt plan amend ${front.id}`, next_actions: [{ cmd: `ts-opt plan amend ${front.id}`, why: 'ask the user first; a finding\'s touches are never widened silently' }] };
  }
  if (flags.origin === 'architect') {
    const rule = loadRules().get(flags.rule);
    if (!rule || !flags.file || !flags.line || !['STRONG', 'WORTH_EXPLORING', 'SPECULATIVE'].includes(flags.recommendation)) throw new TsOptError(EXIT.USAGE, '--origin architect needs --rule, --file, --line and --recommendation STRONG|WORTH_EXPLORING|SPECULATIVE');
    if (touches.length > 5) throw new TsOptError(EXIT.USAGE, 'a proposal touches at most 5 files; split it into sequential findings');
    const evidence = [flags['deletion-test'] && `Deletion Test: ${flags['deletion-test']}`, flags['seam-test'] && `Seam Test: ${flags['seam-test']}`, ...(flags['plan-step'] || []).map((s, i) => `step ${i + 1}: ${s}`)].filter(Boolean);
    let mermaid = null; if (flags['mermaid-file']) { try { mermaid = readFileSync(join(root, flags['mermaid-file']), 'utf8').slice(0, 4000); } catch { /* optional */ } }
    const front = addFinding({ root, runId: id, detect: d, cand: { rule: flags.rule, file: flags.file, line: flags.line, package: '.', engine: 'architect', snippet: mermaid || '', fingerprint: null }, origin: 'architect', touches, reason: flags['deletion-test'] || 'architect proposal', evidence, recommendation: flags.recommendation, confidence: flags.recommendation === 'SPECULATIVE' ? 'speculative' : 'likely', fixMode: flags.recommendation === 'STRONG' ? rule.fix_mode : 'flag-only', wave: flags.recommendation === 'STRONG' ? rule.wave : null });
    return { result: { id: front.id, recommendation: flags.recommendation }, text: `proposed ${front.id} (${flags.recommendation})` };
  }
  throw new TsOptError(EXIT.USAGE, '--origin must be fixer or architect');
}
