declare const a: { b?: number } | undefined;
export const one = a!.b;
export const neq = a!.b!==1;
export const neq2 = a !== undefined && a.b != null;
export const str = 'a!.b!.c';
// x!.y!.z
export function g(n: number) { return !n.toString(); }
export class C { field!: string; other!: number }
const arr = [1, 2];
export const e = arr[0]!;
