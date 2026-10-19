// What works, what is degraded and the single action that fixes each degradation (doc 05 §10).
export function capabilities(d) {
  const deg = [];
  const eng = d.engines || {};
  const usable = (n) => eng[n] && eng[n].works;
  const add = (domain, part, reason, fix) => deg.push({ domain, part, reason, fix });
  const has = (id) => d.gate.legs.some((l) => l.id === id);
  const sfc = (d.frameworks || []).filter((f) => ['vue', 'svelte', 'astro'].includes(f));

  const [maj, min] = process.versions.node.split('.').map(Number);
  if (!d.git.repo) add('fix', 'git', 'not a git repository', '`git init` and commit, or run audit only (fix needs git)');
  if (!usable('knip')) add('reachability', 'knip', eng.knip?.reason === 'absent' ? 'Knip not found' : `Knip unusable (${eng.knip?.reason})`, 'allow the toolbox (`ts-opt toolbox install --yes`) or add knip to the project');
  else if (/^6\./.test(eng.knip.version || '') && (maj < 20 || (maj === 20 && min < 19))) add('reachability', 'knip', `Knip 6 needs Node >= 20.19 (found ${process.versions.node})`, 'use Node >= 20.19 or pin Knip 5');
  if (!usable('ast-grep')) add('structure', 'ast-grep', 'ast-grep not found: tier-2 structural rules are skipped or capped at confidence "likely"', 'install ast-grep (`brew install ast-grep` / `npm i -g @ast-grep/cli`) or allow the toolbox');
  if (!usable('rg')) add('all', 'ripgrep', 'ripgrep not found: the built-in tells engine is used (slower)', 'install ripgrep (optional)');
  if (!usable('type-coverage')) add('types', 'type-coverage', eng['type-coverage']?.reason === 'absent' ? 'type-coverage not found: coverage ratchet uses the escape-hatch@1 proxy metric' : `type-coverage unusable (${eng['type-coverage']?.reason}): proxy metric escape-hatch@1`, 'allow the toolbox (it brings TypeScript 6 for API-dependent engines)');
  if (!d.lint?.engine) add('slop', 'lint engine', 'no Biome/Oxlint/ESLint/Ultracite found: slop "auto" fixes become "assisted", wave B is skipped', 'add a lint engine to the project (optional)');
  else if (!d.lint.usable) add('slop', d.lint.engine, `${d.lint.engine} is configured but not runnable here`, `install dependencies (${d.pm?.name || 'npm'} install)`);
  if (d.compilers && d.compilers.authoritative.kind === 'none') add('types', 'compiler', 'no TypeScript compiler found: tells and Knip only; fix refuses', 'install TypeScript in the project');
  if (d.compilers && !d.compilers.fast) add('toolchain', 'fast compiler', 'no native compiler (tsgo / TypeScript 7): `check` uses the project compiler, fast-check is off', 'run /ts-optimize:tsgo (it explains the options)');
  if (!has('test')) add('fix', 'test script', 'no test script: the plan can only schedule waves B and 4 (zero-runtime type edits)', 'add a `test` script, then re-run `ts-opt baseline`');
  for (const f of sfc) if (!d.gate.legs.some((l) => l.id === 'typecheck' && l.variant === 'script')) add('reachability', f, `${f} project without vue-tsc/svelte-check/astro check script: template-only consumers are invisible, typecheck leg unavailable`, 'add a script that runs the framework checker (e.g. `vue-tsc --noEmit`)');
  if (d.pm?.pnp) add('detect', 'Yarn PnP', 'no node_modules: tools run through `yarn run`; engines are not probed from the project', 'allow the toolbox for engines (optional)');
  for (const u of d.gate.unavailable) if (u.id === 'typecheck') add('fix', 'typecheck', u.reason, 'add a tsconfig.json');

  const domains = {
    platform: d.packs.some((p) => p.name === 'workerd') ? 'ok (workerd pack active)' : 'ok',
    reachability: usable('knip') ? 'ok' : 'unavailable',
    types: d.compilers && d.compilers.authoritative.kind !== 'none' ? (usable('type-coverage') ? 'ok' : 'degraded') : 'partial',
    structure: usable('ast-grep') ? 'ok' : 'degraded',
    slop: d.lint?.usable ? 'ok' : 'degraded',
    toolchain: 'ok',
  };
  return { domains, degradations: deg };
}
