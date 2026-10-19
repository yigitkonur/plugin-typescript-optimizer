// Machine-independent projection of command output for goldens: paths, shas, tool versions found on PATH are normalised.
export function normalize(value, { root, work } = {}) {
  const s = JSON.stringify(value);
  let out = s;
  if (root) out = out.split(root).join('<ROOT>');
  if (work) out = out.split(work).join('<WORK>');
  out = out.replace(/"head":"[0-9a-f]{7,40}"/g, '"head":"<HEAD>"');
  return JSON.parse(out);
}

export function stableDetect(d) {
  return {
    typescript: d.typescript,
    git: { repo: d.git.repo, clean: d.git.clean, branch: d.git.branch },
    pm: d.pm && { name: d.pm.name, version: d.pm.version, source: d.pm.source, pnp: d.pm.pnp, exec: d.pm.exec, run: d.pm.run },
    workspaces: d.workspaces,
    packages: d.packages.map((p) => ({
      path: p.path, name: p.name, kind: p.kind, root_only: p.root_only, workspace_root: p.workspace_root,
      tsconfigs: p.tsconfigs.map((c) => ({ file: c.file, class: c.class, references: c.references })),
      typecheck_set: p.typecheck_set, declaration_signal: p.declaration_signal, scripts: p.scripts, workspace_deps: p.workspace_deps,
      compilers: p.compilers && { kind: p.compilers.authoritative.kind, version: p.compilers.authoritative.version, source: p.compilers.authoritative.source },
    })),
    // only engines installed in the project are stable across machines; PATH tools vary
    engines_project: Object.fromEntries(Object.entries(d.engines).filter(([, e]) => e.source === 'project').map(([n, e]) => [n, { version: e.version, works: e.works }])),
    lint: d.lint && { engine: d.lint.engine, config: d.lint.config },
    frameworks: d.frameworks, packs: d.packs,
    gate: d.gate,
  };
}
