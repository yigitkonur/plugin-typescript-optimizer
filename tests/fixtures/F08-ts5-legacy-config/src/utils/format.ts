export function formatName(first: string, last: string): string {
  return `${last}, ${first}`;
}

export function joinAll(parts: Set<string>): string {
  const out: string[] = [];
  for (const part of parts) {
    out.push(part);
  }
  return out.join(" ");
}
