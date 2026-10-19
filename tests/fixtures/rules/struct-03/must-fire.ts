import { api } from './api';
import { load } from './load';
export const getUser = (id: string) => api.get(id);
export const getUserTyped = async (id: string): Promise<string> => api.get(id);
export const sum2 = (a: number, b: number) => load(a, b);
export function fetchUser(id: string) {
  return api.get(id);
}
export function fetch3(a: string, b: number, c?: boolean): Promise<string> { return load(a, b, c); }
