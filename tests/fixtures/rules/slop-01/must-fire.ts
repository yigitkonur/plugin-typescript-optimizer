async function a() {
  try {
    await work();
  } catch (e) {
    throw e;
  }
}
function b() {
  try { work(); } catch (err) { throw err }
}
function c() {
  try {
    work();
  } catch (error: unknown) {
    // just rethrow
    throw error;
  }
}
function d() {
  try { return load(); } catch (e) { console.error(e); return null; }
}
function f() {
  try { return load(); } catch (e) {
    console.log(e.message)
    return undefined
  }
}
function g() {
  try { work(); } catch (e) {}
}
function h() {
  try { work(); } catch {
  }
}
