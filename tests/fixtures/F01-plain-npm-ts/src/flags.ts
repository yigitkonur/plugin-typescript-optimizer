export function isAdult(age: number): boolean {
  return age >= 18 ? true : false;
}

export function isReady(flag: boolean): boolean {
  if (flag === true) {
    return true;
  }
  return false;
}

// decoy: `_`-prefixed unused parameter and variable are intentional
export function pick(first: string, _second: string): string {
  const _unusedLocal = first.length;
  return first;
}
