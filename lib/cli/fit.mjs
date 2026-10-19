// ts-opt fit [--root <dir>] [--status] [--json]: native-compiler fit probe (doc 05 §8.3). Run-less, read-only on the project;
// writes only .ts-optimize/fit/latest/{fit.json,tsgo-fit.md}. A cannot-probe verdict exits 4 but still prints the result.
import { resolve } from 'node:path';
import { loadConfig } from '../artifacts/config.mjs';
import { EXIT, TsOptError } from '../core/envelope.mjs';
import { tsOptHome } from '../core/home.mjs';
import { detect } from '../detect/index.mjs';
import { runFit } from '../tsgo/fit.mjs';
import { renderReport, renderText } from '../tsgo/report.mjs';
import { loadLatestFit, saveFit } from '../tsgo/store.mjs';

export const spec = { root: 'string', status: 'boolean' };

export async function run({ cwd, flags }) {
  const dir = flags.root ? resolve(cwd, flags.root) : cwd;
  const d = await detect(dir);
  if (!d.typescript) throw new TsOptError(EXIT.NOTHING, `No TypeScript found under ${d.root}; nothing to fit.`);
  const root = d.root;

  if (flags.status) {
    const last = loadLatestFit(root, { head: d.git?.head ?? null });
    const compilers = d.packages.filter((p) => !p.root_only && p.compilers).map((p) => ({ package: p.path, authoritative: p.compilers.authoritative, fast: p.compilers.fast }));
    const result = {
      compilers,
      last: last.fit ? { verdict: last.fit.verdict, generated: last.fit.generated, head: last.fit.head, age_s: last.age_ms == null ? null : Math.round(last.age_ms / 1000), fresh: last.fresh, stale_reason: last.reason, cannot_probe_reason: last.fit.cannot_probe_reason ?? null } : null,
    };
    const L = ['compilers:'];
    for (const c of compilers) L.push(`  ${c.package.padEnd(18)} project ${c.authoritative.kind} ${c.authoritative.version || '?'}; native ${c.fast ? `${c.fast.kind} ${c.fast.version || '?'} (${c.fast.source})` : 'none found'}`);
    L.push(result.last ? `last fit: ${result.last.verdict} (${result.last.generated}${result.last.fresh ? '' : `, stale: ${result.last.stale_reason}`})` : 'last fit: none yet; run `ts-opt fit`');
    return { result, text: L.join('\n'), exit: EXIT.OK };
  }

  const { config, warnings: cfgWarn } = loadConfig(root);
  const warnings = [...cfgWarn];
  const fit = await runFit({ root, detect: d, config, home: tsOptHome() });
  const report = renderReport(fit);
  let files = null;
  try { files = saveFit(root, fit, report); } catch (e) { warnings.push(`fit result not stored: ${e.message}`); }
  const exit = fit.verdict === 'cannot-probe' ? EXIT.CAPABILITY : EXIT.OK;
  return {
    result: { ...fit, files },
    text: renderText(fit, files),
    exit, warnings, next_actions: fit.next_actions || [],
  };
}
