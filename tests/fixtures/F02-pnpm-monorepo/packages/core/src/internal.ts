export function checksum(input: string): number {
  return input.length % 7;
}

export function tag(input: string): string {
  return `${input}#${checksum(input)}`;
}
