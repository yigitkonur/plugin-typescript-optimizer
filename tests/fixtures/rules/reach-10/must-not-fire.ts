// ENABLE_OLD_THING: false, kept as documentation; if (false) is also in this comment
const note = 'ENABLE_X: false';
export const FLAGS = { ENABLE_NEW_CHECKOUT: true, SHOW_BANNER: true };
export const isReady = false;
let enabled = false;
export function f(user: { flags: { beta: boolean } }, flags: { enableX: boolean }) {
  if (user.flags.beta) return 1;
  if (flags.enableX) return 2;
  if (enabled) return 3;
  while (!isReady) { break; }
  return 0;
}
