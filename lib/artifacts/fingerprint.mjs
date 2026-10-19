// Finding fingerprint (doc 04 §3.4): stable across runs; line numbers are deliberately excluded.
import { sha1 } from '../core/hash.mjs';

const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

export function fingerprintOf(c) {
  const anchor = c.symbol ? '' : collapse(c.match && c.snippet ? firstLineWith(c.snippet, c.match) : c.snippet);
  return 'sha1:' + sha1([c.rule, c.package || '.', String(c.file || '').split('\\').join('/'), c.symbol || '', anchor].join('\0'));
}
// anchor on the offending line, not the first line of the snippet window, so unrelated edits above do not change it
function firstLineWith(snippet, match) {
  const first = match.split('\n')[0];
  return snippet.split('\n').find((l) => l.includes(first)) || snippet.split('\n')[0];
}
