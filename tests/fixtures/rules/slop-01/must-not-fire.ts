function a() { try { work(); } catch (e) { throw new Error('ctx', { cause: e }); } }
function b() { try { work(); } catch (e) { logger.error('failed', e); throw e; } }
function c() {
  try {
    work();
  } catch (e) {
    cleanup();
    throw e;
  }
}
function d() { try { return JSON.parse(s); } catch { return null; } }
function e() { try { work(); } catch (err) { console.error('load failed for user', err); return null; } }
function f() { try { work(); } catch (e) { /* intentionally ignored: best-effort telemetry */ } }
function g() { return p.catch(() => {}); }
function h() { return p.catch((e) => { throw e; }); }
function i() { try { work(); } catch (e) { throw wrap(e); } }
function j() { try { work(); } catch (e) { throw e.cause ?? e; } }
function k() { try { work(); } finally { done(); } }
function l() { try { work(); } catch (e) { return fallback(e); } }
function m() { try { work(); } catch (e) { console.error(e); } }
// try { x(); } catch (e) { throw e; }
// try { x(); } catch (e) {}
const s1 = 'try { x(); } catch (e) { throw e; }';
