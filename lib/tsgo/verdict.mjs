// Fit verdict (doc 05 §8.3 step 5). Vocabulary: already-native · ready · ready-with-bridge · needs-config · blocked · not-applicable
// (+ cannot-probe, step 6). Precedence is the order of the checks below, per package; the project verdict is the worst non-native package.

export const VERDICTS = ['already-native', 'ready', 'ready-with-bridge', 'needs-config', 'blocked', 'not-applicable', 'cannot-probe'];
/** project aggregation order, worst first */
export const WORST_FIRST = ['cannot-probe', 'blocked', 'needs-config', 'ready-with-bridge', 'ready'];

/**
 * packageVerdict({applicable, native, canProbe, nativeFailed, configIssues, unexplained, bridgeNeeded}) -> verdict
 *  applicable   a TS package with a tsconfig and a Node compiler (not Deno, not an orchestrating root)
 *  native       the authoritative compiler already is the native one
 *  canProbe     an authoritative compiler and a native compiler could both be run
 *  nativeFailed the native run crashed, timed out or produced no parseable result
 *  configIssues removed options / baseUrl imports / default-change deltas that the T1 fixes clear (auto or assisted)
 *  unexplained  native-only or authoritative-only diagnostics that nothing in the known-divergence table explains
 *  bridgeNeeded tooling that needs the JavaScript compiler API (alias scheme or replacement)
 * An unexplained divergence in a package that ALSO has configuration issues is not "blocked": the configuration can be
 * the cause (removed options change resolution), so the verdict stays needs-config and fit must be re-run after T1.
 */
export function packageVerdict({ applicable = true, native = false, canProbe = true, nativeFailed = false, configIssues = 0, unexplained = 0, bridgeNeeded = false } = {}) {
  if (!applicable) return 'not-applicable';
  if (native) return 'already-native';
  if (!canProbe) return 'cannot-probe';
  if (nativeFailed) return 'blocked';
  if (configIssues > 0) return 'needs-config';
  if (unexplained > 0) return 'blocked';
  if (bridgeNeeded) return 'ready-with-bridge';
  return 'ready';
}

export function projectVerdict(packageVerdicts) {
  const applicable = packageVerdicts.filter((v) => v !== 'not-applicable');
  if (!applicable.length) return 'not-applicable';
  if (applicable.every((v) => v === 'already-native')) return 'already-native';
  const rest = applicable.filter((v) => v !== 'already-native');
  for (const v of WORST_FIRST) if (rest.includes(v)) return v;
  return 'ready';
}
