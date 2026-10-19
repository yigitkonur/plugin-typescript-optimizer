// Retry with exponential backoff because the upstream API rate-limits at 10 rps.
// Set the flag before awaiting to avoid a re-entrancy bug (see #1423).
/** Gets the current user. Throws when unauthenticated. */
export function currentUser() {
  // TODO: return early once the cache is warm
  // Returns early because the cache is warm and the upstream call is expensive.
  // Fetches the token lazily, the first call is slow.
  // return value is ignored
  // set prefault as default
  // Imports are sorted by the formatter; do not reorder them by hand.
  const text = '// Set the user id';
  const tpl = `// Return result`;
  return { text, tpl };
}
/*
 * Gets the thing that was configured at start-up
 * Sets the retry budget so a thundering herd cannot form
 */
export const retries = 3;
