export const clamp = (n: number, lo: number, hi: number): number => {
  if (lo > hi) throw new RangeError("lo > hi");
  return n < lo ? lo : n > hi ? hi : n;
};
