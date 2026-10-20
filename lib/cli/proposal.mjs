// ts-opt proposal add --origin fixer|architect …: record a new finding discovered mid-run or by ts-architect (doc 04 §12).
import { addFinding } from '../artifacts/newfinding.mjs';
import { saveProposal, writeHealth } from '../artifacts/health.mjs';
import { readRun, resolveRunId, stampLog } from '../artifacts/store.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { isFile } from '../core/fs.mjs';
import { join } from 'node:path';
import { loadRules } from '../catalog/index.mjs';
import { detect } from '../detect/index.mjs';
import { findRoot } from '../detect/root.mjs';
import { getFinding } from '../gate/findings.mjs';
import { safeRel } from '../core/pathsafe.mjs';
import { withRunLock } from '../gate/lock.mjs';

export const spec = { origin: 'string', parent: 'string', reason: 'string', rule: 'string', file: 'string', line: 'number', recommendation: 'string', 'deletion-test': 'string', 'seam-test': 'string', touch: 'multi', 'plan-step': 'multi', mermaid: 'string' };

/** structural check of the architect's diagram (the real parser, mermaid-cli, is a dev-time check; this keeps garbage out of codebase-health.md) */
export function checkMermaid(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!/^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/.test(lines[0] || '')) return 'must start with "flowchart TD"';
  const subs = lines.filter((l) => /^subgraph\b/.test(l));
  const ends = lines.filter((l) => l === 'end').length;
  if (subs.length < 2 || ends !== subs.length) return 'needs matching subgraph/end pairs (Before and After)';
  if (!subs.some((l) => /\bBefore\b/i.test(l)) || !subs.some((l) => /\bAfter\b/i.test(l))) return 'subgraphs must be named Before and After';
  if (/[<>]\s*script|javascript:|click\s+\w+\s+(href|call)/i.test(text)) return 'interactive directives are not allowed';
  return null;
}

export async function run({ cwd, flags, args }) {
  if (args[0] !== 'add') throw new TsOptError(EXIT.USAGE, 'usage: ts-opt proposal add --origin fixer --parent F-0007 --reason "…" --touch <path> | --origin architect --rule struct-03 --file … --line … --recommendation STRONG --deletion-test "…" --seam-test "…" --touch …');
  const { root } = await findRoot(cwd);
  const id = resolveRunId(root, flags.run);
  // several architects record proposals at once: queue them (ids, index, plan and health are rewritten together)
  return withRunLock(root, id, 'proposal add', () => add(root, id, flags), { wait: 60_000 });
}

async function add(root, id, flags) {
  const run = readRun(root, id);
  if (!['planned', 'ready', 'locked', 'applying', 'verifying'].includes(run.state)) throw new TsOptError(EXIT.PRECONDITION, `run ${id} is ${run.state}`);
  const d = await detect(root);
  const touches = [];
  for (const t of flags.touch || []) {
    const rel = safeRel(root, t); // lexical and symlink containment
    if (!rel) throw new TsOptError(EXIT.USAGE, `--touch ${t} is outside the repository`);
    if (!isFile(join(root, rel))) throw new TsOptError(EXIT.USAGE, `--touch ${t} does not exist`);
    touches.push(rel);
  }
  if (flags.file !== undefined) {
    const rel = safeRel(root, flags.file);
    if (!rel || !isFile(join(root, rel))) throw new TsOptError(EXIT.USAGE, `--file ${flags.file} is not a file inside the repository`);
    flags.file = rel;
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
    let mermaid = null;
    if (flags.mermaid) {
      mermaid = String(flags.mermaid).replace(/\\n/g, '\n').slice(0, 4000);
      const problem = checkMermaid(mermaid);
      if (problem) throw new TsOptError(EXIT.USAGE, `--mermaid: ${problem}`, 'a flowchart TD with a Before and an After subgraph');
    } else if (flags.recommendation === 'STRONG') {
      throw new TsOptError(EXIT.USAGE, 'a STRONG proposal needs --mermaid (the before/after diagram that codebase-health.md shows for it)', '--mermaid "flowchart TD\\n  subgraph Before\\n    …\\n  end\\n  subgraph After\\n    …\\n  end"');
    }
    const front = addFinding({ root, runId: id, detect: d, cand: { rule: flags.rule, file: flags.file, line: flags.line, package: '.', engine: 'architect', snippet: mermaid || '', fingerprint: null }, origin: 'architect', touches, reason: flags['deletion-test'] || 'architect proposal', evidence, recommendation: flags.recommendation, confidence: flags.recommendation === 'SPECULATIVE' ? 'speculative' : 'likely', fixMode: flags.recommendation === 'STRONG' ? rule.fix_mode : 'flag-only', wave: flags.recommendation === 'STRONG' ? rule.wave : null });
    saveProposal(root, id, { id: front.id, rule: flags.rule, file: flags.file, line: flags.line, recommendation: flags.recommendation, deletion_test: flags['deletion-test'] || null, seam_test: flags['seam-test'] || null, plan_steps: flags['plan-step'] || [], touches: front.touches, wave: front.wave, mermaid });
    writeHealth(root, id, run.mode);
    return { result: { id: front.id, recommendation: flags.recommendation, wave: front.wave, schedulable: front.wave !== null }, text: `proposed ${front.id} (${flags.recommendation})${front.wave === null ? ': not schedulable, listed in codebase-health.md' : `: wave ${front.wave}, needs approval in plan.md`}` };
  }
  throw new TsOptError(EXIT.USAGE, '--origin must be fixer or architect');
}
