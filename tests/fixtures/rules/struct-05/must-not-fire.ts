export function used<T, U>(a: T, b: U): [T, U] { return [a, b]; }
export function constrained<T, U extends T>(a: T, b: U): U { return b; }
export function inBody<T>(x: string): string { const y: T[] = []; return String(y.length) + x; }
export class Holder<T> { value!: T; }
export interface Mapper<I, O> { map(x: I): O }
export type Fn<A extends unknown[], R> = (...a: A) => R;
export type Brand<T, B extends string> = T & { readonly __brand: B };
export function outer(): void { function inner<T>(y: T): T { return y; } inner(1); }
