interface User { id: string; email: string }
export function isUser(val: unknown): val is User {
  return typeof val === 'object' && val !== null;
}
export const isUser2 = (v: unknown): v is User => typeof v === 'object' && v !== null;
export function isUser3(val: unknown): val is User {
  return val !== null && typeof val === 'object';
}
export function isUser4(_val: unknown): _val is User {
  return true;
}
