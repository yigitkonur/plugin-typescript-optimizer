import { slugify } from "./slug.js";
import { parseCsv } from "./csv.js";

export function titleToPath(title: string): string {
  return `/posts/${slugify(title)}`;
}

export function countRows(input: string): number {
  return parseCsv(input).length;
}
