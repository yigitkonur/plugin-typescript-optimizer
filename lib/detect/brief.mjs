// Text renderers for `detect --brief` and `doctor`.
const ver = (v) => (v ? v.replace(/^(\d+\.\d+)\.\d+.*/, '$1') : '');

export function formatBrief(d) {
  if (!d.typescript) return `typescript: none   root: ${d.root}`;
  const g = d.git;
  const gitS = g.repo ? `${g.clean === null ? 'status unknown' : g.clean ? 'clean' : `dirty (${g.dirty_paths})`} on ${g.branch} (${g.head || 'no commits'})` : 'not a git repo';
  const real = d.packages.filter((p) => !p.root_only && !p.workspace_root);
  const apps = real.filter((p) => /^(apps?|services?|examples?|sites?|web)(\/|$)/.test(p.path)).length;
  const pk = real.length === 1 ? `${real.length} (${real[0].path})` : `${real.length} (${apps} apps, ${real.length - apps} libs)`;
  const ws = d.workspaces.sources.length ? d.workspaces.sources.join('+') : d.workspaces.inferred ? 'inferred' : 'none';
  const lines = [];
  lines.push(`typescript: yes   root: ${d.root}   git: ${gitS}`);
  lines.push(`pm: ${d.pm.name}${d.pm.version ? ' ' + d.pm.version : ''} (${d.pm.source || 'none'})${d.pm.pnp ? ' PnP' : ''}   packages: ${pk}   workspaces: ${ws}`);
  const c = d.compilers;
  if (c) {
    const a = c.authoritative; const f = c.fast; const api = c.api_provider;
    const aS = a.kind === 'none' ? 'tsc none' : `tsc ${a.version || '?'} (${a.kind})${a.source === 'pnp' ? ' via yarn run' : ''}`;
    lines.push(`compilers: ${aS} · fast: ${f ? `${f.kind} ${f.version || '?'} (${f.source})` : 'none'} · api: ${api ? api.version : 'none'}`);
  }
  const engS = [];
  for (const [n, e] of Object.entries(d.engines)) {
    if (e.reason === 'absent') { if (['ast-grep', 'rg', 'knip', 'type-coverage'].includes(n)) engS.push(`${n} absent`); continue; }
    if (!e.works) { engS.push(`${n} ${ver(e.version)} (broken: ${e.reason})`); continue; }
    if (['eslint', 'biome', 'oxlint', 'ultracite'].includes(n) && d.lint?.engine !== n) continue;
    engS.push(`${n} ${ver(e.version)} (${n === d.lint?.engine ? 'lint' : e.source})`.replace('  ', ' '));
  }
  lines.push(`engines: ${engS.join(' · ') || 'none'}`);
  const pk2 = d.packs.map((p) => `${p.name} (${p.paths.join(', ')})`).join(' · ') || 'none';
  lines.push(`packs: ${pk2} · frameworks: ${d.frameworks.join(', ') || 'none'}`);
  const legs = d.gate.legs; const un = d.gate.unavailable;
  const tcN = legs.filter((l) => l.id === 'typecheck').length;
  const one = (id) => { const l = legs.find((x) => x.id === id); return l ? `${id} ✓ ${l.argv ? l.argv.join(' ') : ''}`.trim() : un.find((u) => u.id === id) ? `${id} ✗ none` : null; };
  const decl = [...new Set(legs.filter((l) => l.id === 'declaration-emit').map((l) => l.cwd))];
  const gateParts = [tcN ? `typecheck ✓ (${tcN} ${tcN === 1 ? 'config' : 'configs'})` : 'typecheck ✗ none', one('test'), one('build'), decl.length ? `declaration-emit: ${decl.join(', ')}` : null].filter(Boolean);
  lines.push(`gate: ${gateParts.join(' · ')}`);
  if (d.open_run) lines.push(`open run: ${d.open_run.id}${d.open_run.state ? ' (' + d.open_run.state + ')' : ''}`);
  return lines.join('\n');
}
