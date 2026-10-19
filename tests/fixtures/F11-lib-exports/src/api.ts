import { makeSession } from "./session.js";

export function open() {
  return makeSession();
}

export function describe(id: string, n: number) {
  return { id, label: `session ${n}` };
}

export const DEFAULT_LIMIT = 10;
