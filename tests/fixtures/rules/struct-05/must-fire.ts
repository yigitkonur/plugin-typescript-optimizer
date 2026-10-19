declare function load<T>(id: string): Promise<T>;
export function fetchItem<T = unknown, E = Error>(id: string): Promise<T> { return load<T>(id); }
export const wrap = <T, E = Error>(x: T): T => x;
export interface Box<T, U = never> { value: T }
export type Pair<A, B> = { a: A };
export class Repo<T, K = string> { find(id: string): T { return null as T; } }
