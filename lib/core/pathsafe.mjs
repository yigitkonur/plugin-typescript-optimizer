// Containment checks for paths that come from the audited repository (finding touches, anchors, config, artifacts).
// A repository can contain symlinks; a lexical `..` check is not enough. All checks resolve the real path first.
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const isUnder = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** realpath of the longest existing prefix, with the not-yet-existing tail appended (so a new file below a symlinked dir is still caught) */
export function realish(p) {
  let cur = resolve(p); const tail = [];
  for (;;) {
    try { return join(realpathSync(cur), ...tail.reverse()); } catch { /* does not exist yet */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    tail.push(cur.slice(up.length + 1)); cur = up;
  }
}

/** true when `p` (absolute, or relative to `root`) really lives inside `root` */
export function insideRoot(root, p) {
  const base = realish(root);
  const abs = realish(isAbsolute(p) ? p : join(root, p));
  return isUnder(abs, base);
}

/** repo-relative posix path of a user/engine supplied path, or null when it escapes the repository (lexically or through a symlink) */
export function safeRel(root, p) {
  const s = String(p || '');
  if (!s || s.includes('\0')) return null;
  const abs = isAbsolute(s) ? s : join(root, s);
  if (!insideRoot(root, abs)) return null;
  const rel = relative(resolve(root), resolve(abs));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

export const isSymlink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

/** the artifact tree must be real directories and files: returns the first symlink found (or null). Bounded walk. */
export function firstSymlinkUnder(dir, limit = 60000) {
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++seen > limit) return null;
      const p = join(d, e.name);
      if (e.isSymbolicLink()) return p;
      if (e.isDirectory()) stack.push(p);
    }
  }
  return null;
}
