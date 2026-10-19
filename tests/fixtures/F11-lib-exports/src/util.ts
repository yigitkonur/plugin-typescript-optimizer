export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function internalHelper(x: number): number {
  return x * 2;
}

export function double(x: number): number {
  return internalHelper(x);
}
