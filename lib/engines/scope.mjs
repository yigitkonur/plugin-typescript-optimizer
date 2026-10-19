// Which files an audit looks at: git index minus pruned dirs, config scope, workspace filter, --diff (doc 05 §1, doc 07 Flow F).
import { run } from '../core/proc.mjs';
import { toPosix } from '../core/fs.mjs';
import { compileGlob } from '../core/glob.mjs';
import { isPruned } from '../core/files.mjs';
import { walkFiles } from '../core/files.mjs';
import { SOURCE_EXT } from '../detect/classify.mjs';

const prunedPath = (f) => f.split('/').some((seg, i, a) => i < a.length - 1 && isPruned(seg));

async function gitLines(root, args) {
  const r = await run(['git', ...args], { cwd: root, timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024 });
  return r.code === 0 ? r.stdout.split('\0').join('\n').split('\n').filter(Boolean).map(toPosix) : null;
}

export async function defaultBranch(root) {
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
    const r = await run(['git', 'rev-parse', '--verify', '--quiet', b], { cwd: root, timeoutMs: 5000 });
    if (r.code === 0) return b;
  }
  return null;
}

/**
 * -> { files:[rel], all_count, diff:{base, files}|null, warnings[] }
 */
export async function collectFiles(root, { isGit, config, workspacePaths = null, diff = null }) {
  const warnings = [];
  let files;
  if (isGit) {
    const lines = await gitLines(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate']);
    files = lines || walkFiles(root, [], 6);
  } else files = walkFiles(root, [], 6);
  files = files.filter((f) => SOURCE_EXT.test(f) && !prunedPath(f));
  const allCount = files.length;
  const allFiles = files.slice().sort();

  const inc = (config.scope?.include || []).map((g) => compileGlob(g, { dot: true }));
  const exc = (config.scope?.exclude || []).map((g) => compileGlob(g, { dot: true }));
  if (inc.length) files = files.filter((f) => inc.some((r) => r.test(f)));
  if (exc.length) files = files.filter((f) => !exc.some((r) => r.test(f)));
  if (workspacePaths) files = files.filter((f) => workspacePaths.some((p) => p === '.' || f === p || f.startsWith(p + '/')));

  let diffInfo = null;
  if (diff) {
    if (!isGit) warnings.push('--diff needs a git repository; auditing the full scope');
    else {
      const base = diff === true ? await defaultBranch(root) || 'HEAD~1' : diff;
      const changed = new Set();
      const committed = await gitLines(root, ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${base}...HEAD`]);
      const working = await gitLines(root, ['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD']);
      const untracked = await gitLines(root, ['ls-files', '-z', '--others', '--exclude-standard']);
      if (committed === null && working === null) warnings.push(`--diff=${base}: base not found; auditing the full scope`);
      else {
        for (const l of [committed, working, untracked]) for (const f of l || []) changed.add(f);
        files = files.filter((f) => changed.has(f));
        diffInfo = { base, files: files.length };
      }
    }
  }
  return { files: files.sort(), all_files: allFiles, all_count: allCount, diff: diffInfo, warnings };
}
