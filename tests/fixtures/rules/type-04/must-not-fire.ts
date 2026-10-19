import { z } from 'zod';
interface User { id: string; email: string }
const UserSchema = z.object({ id: z.string(), email: z.string() });
export function isUser(val: unknown): val is User {
  return UserSchema.safeParse(val).success;
}
export function isUserFull(val: unknown): val is User {
  return typeof val === 'object' && val !== null && typeof (val as User).id === 'string' && typeof (val as User).email === 'string';
}
export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
export const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null;
export const isStr = (v: unknown): v is string => typeof v === 'string';
