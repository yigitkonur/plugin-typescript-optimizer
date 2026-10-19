import { slugLength } from "./internal.ts";

export function lengthOf(input: string): number {
  return slugLength(input);
}
