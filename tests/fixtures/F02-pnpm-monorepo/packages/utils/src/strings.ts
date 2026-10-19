export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/\s+/g, "-");
}

export function truncate(input: string, max: number): string {
  return input.length > max ? input.slice(0, max) : input;
}
