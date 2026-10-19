// A real module that happens to be called index.ts: logic, no wildcard re-export, no barrel imports.
import { parse } from './parse';
export function load(source: string) {
  return parse(source).filter(Boolean);
}
export const VERSION = '1';
