export function parseCsv(input: string): string[][] {
  return input
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

export function unusedHelper(): string {
  return "never imported";
}
