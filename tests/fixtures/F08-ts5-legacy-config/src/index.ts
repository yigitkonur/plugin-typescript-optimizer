import { formatName } from "./utils/format";

export function greet(first: string, last: string): string {
  return `Hello ${formatName(first, last)}`;
}
