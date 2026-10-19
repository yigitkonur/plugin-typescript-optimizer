export function f(a: number, flag: boolean, done: boolean) {
  const x = a > 1 ? true : false;
  const y = flag ? false : true;
  if (flag === true) { log(x, y); }
  if (done !== false) { log(a); }
  if (!!flag) { log(a); }
  while (!!a) { a--; }
  return !!flag;
}
export function g(a: number) {
  if (a > 1) {
    return true;
  } else {
    return false;
  }
}
export function h(a: number) {
  if (a > 1) return false;
  return true;
}
export class K extends Base {
  m(v: boolean) { return v ? true : false; }
}
