// JSON envelope + exit codes (doc 02 §3.1).
export const EXIT = Object.freeze({
  OK: 0, USAGE: 2, NOTHING: 3, CAPABILITY: 4, PRECONDITION: 5, GATE: 6, GUARD: 7, ARTIFACT: 8, INTERNAL: 70,
});
export const EXIT_NAME = Object.fromEntries(Object.entries(EXIT).map(([k, v]) => [v, k.toLowerCase()]));
export const ENVELOPE_SCHEMA = 'ts-optimize/envelope@1';

export class TsOptError extends Error {
  constructor(code, message, hint = null, name = null) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.errName = name || EXIT_NAME[code] || 'error';
  }
}

export function envelope({ ok = true, result = null, warnings = [], next_actions = [], error = null } = {}) {
  return { ok, schema: ENVELOPE_SCHEMA, result, warnings, next_actions, error };
}

export function errorEnvelope(err) {
  const code = err instanceof TsOptError ? err.code : EXIT.INTERNAL;
  return envelope({
    ok: false,
    error: {
      code,
      name: err instanceof TsOptError ? err.errName : 'internal',
      message: String(err && err.message || err),
      hint: err instanceof TsOptError ? err.hint : null,
    },
  });
}
