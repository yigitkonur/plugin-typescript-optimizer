// ast-grep structural tier (doc 05 §7): precise matches that regex cannot tell (JSX text, shape of a wrapper, anemic guards).
// When it ran for a rule, its matches replace the rule's regex tells (regex = broad candidate generator, ast-grep = precision).
import { join } from 'node:path';
import { CATALOG_DIR } from '../catalog/index.mjs';
import { run as runProc } from '../core/proc.mjs';
import { isFile } from '../core/fs.mjs';
import { log } from '../core/log.mjs';
import { isGeneratedPath, isTestPath, packageOf } from '../detect/classify.mjs';

export const name = 'astgrep';
export const handles = (rule) => Array.isArray(rule.astgrep) && rule.astgrep.length > 0;
export function available(d) {
  const e = d.engines?.['ast-grep'];
  return e && e.works ? { ok: true } : { ok: false, reason: 'ast-grep not found: structural rules are skipped and regex candidates are capped at confidence "likely"' };
}

export async function run(ctx) {
  const { root, detect: d, rules, scope } = ctx;
  const bin = d.engines['ast-grep'].bin;
  const inScope = new Set(scope.files);
  const candidates = [];
  const ranRules = [];
  const failed = [];
  for (const rule of rules) {
    let ok = true;
    for (const rel of rule.astgrep) {
      const yml = join(CATALOG_DIR, rel);
      if (!isFile(yml)) { failed.push(`${rule.id}: ${rel} missing`); ok = false; continue; }
      log(`[astgrep] ${rule.id} ${rel}`);
      const r = await runProc([bin, 'scan', '--rule', yml, '--json=stream'], { cwd: root, timeoutMs: 180_000, maxBytes: 128 * 1024 * 1024 });
      if (r.timedOut || (r.code !== 0 && r.code !== 1 && !r.stdout)) { failed.push(`${rule.id}: ast-grep failed (${r.timedOut ? 'timeout' : 'exit ' + r.code}) ${r.stderr.trim().split('\n')[0] || ''}`); ok = false; continue; }
      for (const line of r.stdout.split('\n')) {
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        const file = String(m.file || '').replace(/^\.\//, '');
        if (!inScope.has(file) || isGeneratedPath(file)) continue;
        const ln = (m.range?.start?.line ?? 0) + 1;
        candidates.push({
          rule: rule.id, domain: rule.domain, engine: `astgrep:${m.ruleId}`, package: packageOf(file, d.packages), file, line: ln, col: (m.range?.start?.column ?? 0) + 1,
          symbol: null, grain: rule.grain || 'symbol', snippet: String(m.lines || m.text || '').trim().slice(0, 400), match: String(m.text || '').slice(0, 120), tells: [m.ruleId],
          severity_hint: rule.severity, batch: rule.batch ?? null, wave: rule.wave ?? null, fix_mode_hint: rule.fix_mode_by_tell?.[String(m.ruleId).replace(/-tsx$/, '')] ?? rule.fix_mode, consumers: [], triage: rule.triage || 'agent',
          path_class: isTestPath(file) ? 'test' : 'source',
        });
      }
    }
    if (ok) ranRules.push(rule.id);
  }
  // one candidate per (rule, file, line)
  const seen = new Map();
  for (const c of candidates) { const k = `${c.rule}:${c.file}:${c.line}`; const p = seen.get(k); if (p) p.tells.push(...c.tells); else seen.set(k, c); }
  return { candidates: [...seen.values()], notes: { replaces_tells_for: ranRules, failed } };
}
