// unrelated name that only shares a prefix: must stay silent
export function slugifyFilename(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9.]+/g, "-");
}
