// Project-level adapters: tsconfig strictness ladder (type-09), declaration-emit failures (type-07), comment ratio (slop-02).
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runProc } from '../core/proc.mjs';
import { isGeneratedPath, isTestPath, packageOf } from '../detect/classify.mjs';
import { maskSource } from './mask.mjs';

export const name = 'project';
const ADAPTERS = new Set(['tsc:declaration-emit', 'tsconfig-health', 'fs:comment-ratio']);
export const handles = (rule) => ADAPTERS.has(String(rule.adapter || ''));
export const available = () => ({ ok: true });

const DECL_CODES = new Set(['TS4023', 'TS4058', 'TS4060', 'TS4081', 'TS4082', 'TS2742', 'TS2883', 'TS4094', 'TS4025', 'TS4033', 'TS4042']);

export { parseDiagnostics } from '../gate/diagnostics.mjs';
import { parseDiagnostics } from '../gate/diagnostics.mjs';

const mk = (rule, d, extra) => ({
  rule: rule.id, domain: rule.domain, package: '.', line: 1, col: 1, symbol: null, grain: rule.grain || 'symbol', severity_hint: rule.severity, batch: rule.batch ?? null,
  wave: rule.wave ?? null, fix_mode_hint: rule.fix_mode, consumers: [], triage: rule.triage || 'agent', path_class: 'source', ...extra,
});

export async function run(ctx) {
  const { root, detect: d, rules, scope, config } = ctx;
  const byAdapter = (a) => rules.find((r) => r.adapter === a);
  const out = []; const notes = {}; const degraded = [];

  const th = byAdapter('tsconfig-health');
  if (th) {
    const rows = [];
    for (const p of d.packages) {
      if (p.root_only || !p.signals || p.kind === 'deno') continue;
      const cfg = p.tsconfigs.find((c) => c.file === 'tsconfig.json') || p.tsconfigs.find((c) => c.class === 'project');
      if (!cfg || cfg.class === 'solution') continue; // a solution config holds no compiler options
      const s = p.signals;
      const gaps = [];
      if (s.strict !== true) gaps.push('strict');
      if (s.noUncheckedIndexedAccess !== true) gaps.push('noUncheckedIndexedAccess');
      if (s.exactOptionalPropertyTypes !== true) gaps.push('exactOptionalPropertyTypes');
      if (s.verbatimModuleSyntax !== true) gaps.push('verbatimModuleSyntax');
      if (s.useUnknownInCatchVariables === false || (s.useUnknownInCatchVariables === null && s.strict !== true)) gaps.push('useUnknownInCatchVariables');
      if (p.declaration_signal && s.isolatedDeclarations !== true) gaps.push('isolatedDeclarations');
      if (gaps.length) rows.push({ p, cfg, gaps, file: (p.path === '.' ? '' : p.path + '/') + cfg.file });
    }
    // packages that share one gap set (typically a shared tsconfig.base.json) are one finding, not N copies
    const groups = new Map();
    for (const r of rows) (groups.get(r.gaps.join(',')) || groups.set(r.gaps.join(','), []).get(r.gaps.join(','))).push(r);
    const base = d.packages.find((p) => p.path === '.')?.tsconfigs.find((c) => c.class === 'base' || /^tsconfig\.(base|shared|common)\.json$/.test(c.file));
    for (const list of groups.values()) {
      if (list.length >= 2 && base) out.push(mk(th, d, { engine: 'tsconfig-health', package: '.', file: base.file, snippet: `missing or off in ${list.length} packages (${list.map((r) => r.p.path).join(', ').slice(0, 200)}): ${list[0].gaps.join(', ')}`, raw_ref: 'tsconfig-health', triage: 'deterministic' }));
      else for (const r of list) out.push(mk(th, d, { engine: 'tsconfig-health', package: r.p.path, file: r.file, snippet: `missing or off in the resolved config: ${r.gaps.join(', ')}`, raw_ref: 'tsconfig-health', triage: 'deterministic' }));
    }
  }

  const de = byAdapter('tsc:declaration-emit');
  if (de) {
    for (const p of d.packages) {
      if (p.root_only || !p.declaration_signal || p.kind === 'deno') continue;
      const comp = p.compilers?.authoritative;
      const cfg = p.tsconfigs.find((c) => c.file === 'tsconfig.json' && c.class === 'project');
      if (!comp?.bin || !cfg) { degraded.push({ domain: 'types', part: `type-07 (${p.path})`, reason: 'no project compiler or project tsconfig for the declaration-emit probe' }); continue; }
      const tmp = mkdtempSync(join(tmpdir(), 'tsopt-decl-'));
      try {
        const r = await runProc([comp.bin, '-p', cfg.file, '--declaration', '--emitDeclarationOnly', '--noEmit', 'false', '--outDir', tmp, '--tsBuildInfoFile', join(tmp, 'x.tsbuildinfo'), '--pretty', 'false'], { cwd: join(root, p.path === '.' ? '' : p.path), timeoutMs: (config.gate?.timeout_s?.typecheck || 600) * 1000, maxBytes: 64 * 1024 * 1024 });
        notes[`decl:${p.path}`] = { ms: r.ms, exit: r.code };
        for (const g of parseDiagnostics(r.stdout + '\n' + r.stderr)) {
          if (!DECL_CODES.has(g.code)) continue;
          const file = (p.path === '.' ? '' : p.path + '/') + g.file;
          out.push(mk(de, d, { engine: `tsc:${comp.version || '?'}:${g.code}`, package: p.path, file, line: g.line, col: g.col, snippet: `${g.code}: ${g.message}`.slice(0, 400), raw_ref: `tsc:${g.code}`, triage: 'deterministic' }));
        }
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    }
  }

  const cr = byAdapter('fs:comment-ratio');
  if (cr) {
    for (const f of scope.files) {
      if (!/\.[cm]?tsx?$/.test(f) || /\.d\.[cm]?ts$/.test(f) || isGeneratedPath(f) || isTestPath(f)) continue;
      let text; try { text = await readFile(join(root, f), 'utf8'); } catch { continue; }
      if (text.length > 512 * 1024) continue;
      const { code, comments } = maskSource(text);
      const cl = code.split('\n'); const ml = comments.split('\n');
      let codeLines = 0; let commentLines = 0; let seenCode = false;
      for (let i = 0; i < cl.length; i++) {
        const hasCode = /\S/.test(cl[i]); const hasComment = /\S/.test(ml[i]);
        if (hasCode) { codeLines++; seenCode = true; } else if (hasComment && seenCode) commentLines++; // the leading header does not count
        else if (hasComment && !seenCode && !/^\s*(\/\/|\/\*|\*)/.test(ml[i])) commentLines++;
      }
      if (codeLines >= 12 && commentLines / codeLines > 1 / 3) {
        const pct = Math.round((commentLines / codeLines) * 100);
        out.push(mk(cr, d, { engine: 'fs:comment-ratio', package: packageOf(f, d.packages), file: f, grain: 'file', snippet: `${commentLines} comment lines vs ${codeLines} code lines (${pct}%)`, raw_ref: 'fs:comment-ratio', path_class: 'source' }));
      }
    }
  }
  notes.degraded = degraded;
  return { candidates: out, notes };
}
