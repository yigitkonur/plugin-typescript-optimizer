export function legacySlugify(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}
