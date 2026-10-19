export function normalize(input: string): string {
  return input.trim().toLowerCase();
}

export function slugLength(input: string): number {
  return normalize(input).length;
}
