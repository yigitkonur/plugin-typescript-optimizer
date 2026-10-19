// decoy: an index.ts that is a real module, not a barrel
export function clampIndex(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
