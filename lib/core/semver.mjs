// Minimal semver (parse, compare, satisfies, coerce). Zero dependencies.
// Non-semver specifiers (workspace:*, catalog:, git urls, latest) never satisfy and never throw.

const VERSION_RE = /^[=v\s]*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?\s*$/;

function ids(s) {
  return s.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
}

export function parseVersion(s) {
  if (typeof s !== 'string' || s.length > 256) return null;
  const m = VERSION_RE.exec(s);
  if (!m) return null;
  const pre = m[4] ? ids(m[4]) : [];
  if (pre.some((x) => x === '')) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: pre,
    build: m[5] ? m[5].split('.') : [],
    raw: s,
  };
}

function asVersion(v) {
  const r = typeof v === 'string' ? parseVersion(v) : v;
  if (!r || typeof r.major !== 'number') throw new TypeError(`Invalid version: ${String(v)}`);
  return r;
}

function cmpNum(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpPre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = typeof x === 'number';
    const yn = typeof y === 'number';
    if (xn && yn) return cmpNum(x, y);
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Throws TypeError for unparsable input (use parseVersion first when unsure).
export function compareVersions(a, b) {
  const x = asVersion(a);
  const y = asVersion(b);
  return cmpNum(x.major, y.major) || cmpNum(x.minor, y.minor) || cmpNum(x.patch, y.patch) || cmpPre(x.prerelease, y.prerelease);
}

const mk = (major, minor, patch, prerelease = []) => ({ major, minor, patch, prerelease, build: [] });

const WILD = /^[xX*]$/;
const PARTIAL_RE = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parsePartial(s) {
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const num = (x) => (x === undefined || WILD.test(x) ? null : Number(x));
  const major = num(m[1]);
  const minor = major === null ? null : num(m[2]);
  const patch = minor === null ? null : num(m[3]);
  return { major, minor, patch, pre: m[4] && patch !== null ? ids(m[4]) : [] };
}

const ANY = [];
const NONE = [{ op: '<', v: mk(0, 0, 0, [0]) }];
const lt = (M, m, p) => ({ op: '<', v: mk(M, m, p) });
const gte = (M, m, p, pre) => ({ op: '>=', v: mk(M, m, p, pre) });

function expand(op, s) {
  const pt = parsePartial(s);
  if (!pt) return null;
  const { major: M, minor: m, patch: p, pre } = pt;
  if (op === '^') {
    if (M === null) return ANY;
    if (m === null) return [gte(M, 0, 0), lt(M + 1, 0, 0)];
    if (p === null) return M > 0 ? [gte(M, m, 0), lt(M + 1, 0, 0)] : [gte(0, m, 0), lt(0, m + 1, 0)];
    if (M > 0) return [gte(M, m, p, pre), lt(M + 1, 0, 0)];
    if (m > 0) return [gte(0, m, p, pre), lt(0, m + 1, 0)];
    return [gte(0, 0, p, pre), lt(0, 0, p + 1)];
  }
  if (op === '~' || op === '~>') {
    if (M === null) return ANY;
    if (m === null) return [gte(M, 0, 0), lt(M + 1, 0, 0)];
    if (p === null) return [gte(M, m, 0), lt(M, m + 1, 0)];
    return [gte(M, m, p, pre), lt(M, m + 1, 0)];
  }
  if (op === '' || op === '=') {
    if (M === null) return ANY;
    if (m === null) return [gte(M, 0, 0), lt(M + 1, 0, 0)];
    if (p === null) return [gte(M, m, 0), lt(M, m + 1, 0)];
    return [{ op: '=', v: mk(M, m, p, pre) }];
  }
  if (op === '>=') return M === null ? ANY : [gte(M, m || 0, p || 0, pre)];
  if (op === '<=') {
    if (M === null) return ANY;
    if (m === null) return [lt(M + 1, 0, 0)];
    if (p === null) return [lt(M, m + 1, 0)];
    return [{ op: '<=', v: mk(M, m, p, pre) }];
  }
  if (op === '>') {
    if (M === null) return NONE;
    if (m === null) return [gte(M + 1, 0, 0)];
    if (p === null) return [gte(M, m + 1, 0)];
    return [{ op: '>', v: mk(M, m, p, pre) }];
  }
  if (op === '<') {
    if (M === null) return NONE;
    return [{ op: '<', v: mk(M, m || 0, p || 0, pre) }];
  }
  return null;
}

// Returns an array of comparators, or null if the set is not valid semver.
function parseSet(set) {
  let s = set.trim();
  if (s === '') return ANY;
  const hy = /^(\S+)\s+-\s+(\S+)$/.exec(s);
  if (hy) {
    const lo = parsePartial(hy[1]);
    const hi = parsePartial(hy[2]);
    if (!lo || !hi) return null;
    const out = [];
    if (lo.major !== null) out.push(gte(lo.major, lo.minor || 0, lo.patch || 0, lo.pre));
    if (hi.major === null) return out;
    if (hi.minor === null) out.push(lt(hi.major + 1, 0, 0));
    else if (hi.patch === null) out.push(lt(hi.major, hi.minor + 1, 0));
    else out.push({ op: '<=', v: mk(hi.major, hi.minor, hi.patch, hi.pre) });
    return out;
  }
  s = s.replace(/(<=|>=|~>|[<>=~^])\s+/g, '$1');
  const out = [];
  for (const tok of s.split(/\s+/)) {
    const m = /^(<=|>=|~>|[<>=~^])?(.*)$/.exec(tok);
    const comps = expand(m[1] || '', m[2]);
    if (!comps) return null;
    out.push(...comps);
  }
  return out;
}

function test(v, c) {
  const r = compareVersions(v, c.v);
  switch (c.op) {
    case '>=': return r >= 0;
    case '<=': return r <= 0;
    case '>': return r > 0;
    case '<': return r < 0;
    default: return r === 0;
  }
}

export function satisfies(version, range) {
  try {
    const v = typeof version === 'string' ? parseVersion(version) : version;
    if (!v || typeof range !== 'string' || range.length > 1024) return false;
    for (const set of range.split('||')) {
      const comps = parseSet(set);
      if (!comps) continue;
      if (!comps.every((c) => test(v, c))) continue;
      if (v.prerelease.length > 0) {
        const allowed = comps.some(
          (c) => c.v.prerelease.length > 0 && c.v.major === v.major && c.v.minor === v.minor && c.v.patch === v.patch,
        );
        if (!allowed) continue;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function coerce(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim();
  if (/^(git|github|gitlab|bitbucket|file|link|portal|patch|https?|ssh)\b[:+]/i.test(t) || t.includes('://')) return null;
  if (t.startsWith('npm:')) {
    const at = t.lastIndexOf('@');
    t = at > 3 ? t.slice(at + 1) : t.slice(4);
  }
  if (t.startsWith('workspace:')) t = t.slice('workspace:'.length);
  const m = /(\d{1,16})(?:\.(\d{1,16}|[xX*]))?(?:\.(\d{1,16}|[xX*]))?/.exec(t);
  if (!m) return null;
  const num = (x) => (x === undefined || WILD.test(x) ? 0 : Number(x));
  return `${Number(m[1])}.${num(m[2])}.${num(m[3])}`;
}

export function major(s) {
  const c = coerce(s);
  return c === null ? null : Number(c.split('.')[0]);
}
