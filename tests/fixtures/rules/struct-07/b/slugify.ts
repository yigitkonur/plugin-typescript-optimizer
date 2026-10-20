/** local copy of the same helper: reformatted, parameter renamed, comments added */
export function slugify(
  text: string
): string {
  // lower, trim, dash
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-"); // collapse separators
}
