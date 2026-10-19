import { greet } from "./greet.js";
import { parseName } from "./parse.js";

export function main(raw: string): string {
  return greet(parseName(raw));
}
