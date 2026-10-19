import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from '../detect/index.mjs';
import { formatBrief } from '../detect/brief.mjs';
import { capabilities } from '../detect/capabilities.mjs';
import { readJsonc } from '../core/fs.mjs';
import { PLUGIN_ROOT, tsOptHome } from '../core/home.mjs';
import { pluginVersion } from './main.mjs';

export const spec = { refresh: 'boolean' };

function hooksSummary() {
  const f = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
  if (!existsSync(f)) return [];
  const j = readJsonc(f);
  if (!j.ok) return [`hooks.json unreadable: ${j.error}`];
  const out = [];
  for (const [ev, groups] of Object.entries(j.value.hooks || {})) {
    for (const g of groups) for (const h of g.hooks || []) {
      const m = /lib\/hooks\/([a-z-]+)\.mjs/.exec(h.command || '');
      out.push(`${ev}${g.matcher ? `(${g.matcher})` : ''} → ${m ? m[1] : '?'}${h.if ? ` [if ${h.if}]` : ''}`);
    }
  }
  return out;
}

function toolboxState(home) {
  const consent = readJsonc(join(home, 'consent.json'));
  return {
    installed: existsSync(join(home, 'toolbox', 'node_modules')),
    native_installed: existsSync(join(home, 'toolbox-native', 'node_modules')),
    consent: consent.ok ? consent.value.toolbox ?? 'unset' : 'unset',
    home,
  };
}

export async function run({ cwd, flags }) {
  const d = await detect(cwd, { refresh: !!flags.refresh });
  const home = tsOptHome();
  const caps = d.typescript ? capabilities(d) : { domains: {}, degradations: [] };
  const tb = toolboxState(home);
  const cfgPath = join(d.root, '.ts-optimize', 'config.json');
  const cfg = existsSync(cfgPath) ? readJsonc(cfgPath) : null;
  const hooks = hooksSummary();
  const result = { plugin: pluginVersion(), node: process.version, detect: d, domains: caps.domains, degradations: caps.degradations, toolbox: tb, config: cfg ? { ok: cfg.ok, error: cfg.ok ? null : cfg.error } : null, hooks };

  const L = [`ts-optimize doctor — plugin ${result.plugin} · node ${process.version}`, '', formatBrief(d)];
  if (!d.typescript) {
    L.push('', `No TypeScript found under ${d.root} (${d.why}); every command exits quietly and no hook speaks here.`);
  } else {
    L.push('', 'capabilities:');
    for (const [k, v] of Object.entries(caps.domains)) L.push(`  ${k.padEnd(13)} ${v}`);
    if (d.compilers) {
      const a = d.compilers.authoritative;
      L.push('', `compilers (package ${d.compilers.package}): authoritative ${a.kind} ${a.version || '?'}${a.bin ? ' @ ' + a.bin : ''}`);
    }
    L.push('', 'engines:');
    for (const [n, e] of Object.entries(d.engines)) L.push(`  ${n.padEnd(14)} ${e.reason === 'absent' ? 'absent' : `${e.version || '?'} (${e.source}) ${e.works ? 'works' : 'BROKEN: ' + e.reason}`}`);
    if (d.lint?.engine) L.push(`  lint engine    ${d.lint.engine} (${d.lint.config}); autofix ${d.lint.autofix ? d.lint.autofix.slice(1).join(' ') : 'unavailable'}`);
    L.push('', 'gate legs:');
    for (const l of d.gate.legs) L.push(`  ${l.id.padEnd(16)} ${l.cwd.padEnd(18)} ${l.argv ? l.argv.join(' ') : l.variant + (l.config ? ' ' + l.config : '') + (l.checker ? ' [' + l.checker + ']' : '')}`);
    for (const u of d.gate.unavailable) L.push(`  ${u.id.padEnd(16)} UNAVAILABLE: ${u.reason}`);
    if (caps.degradations.length) {
      L.push('', 'degradations (each with the single action that fixes it):');
      for (const x of caps.degradations) L.push(`  - [${x.domain}] ${x.part}: ${x.reason}\n      fix: ${x.fix}`);
    } else L.push('', 'degradations: none');
  }
  L.push('', `toolbox: ${tb.installed ? 'installed' : 'not installed'}${tb.native_installed ? ' (+native)' : ''}, consent ${tb.consent} (${tb.home})`);
  L.push(`config: ${cfg ? (cfg.ok ? '.ts-optimize/config.json ok' : 'INVALID ' + cfg.error) : 'none (defaults)'}`);
  L.push(`hooks: ${hooks.length ? '\n  ' + hooks.join('\n  ') : 'none registered yet'}`);
  return { result, text: L.join('\n'), exit: 0 };
}
