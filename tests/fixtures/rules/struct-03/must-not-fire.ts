import { api } from './api';
import { log } from './log';
// Each of these adds something, so the Deletion Test finds real work in the wrapper.
export const a = (id: string) => api.get(`/u/${id}`);
export const b = (id: string) => api.get(id, { retry: 1 });
export const c = (x: string, y: string) => api.get(y, x);
export const d = (x: string, y = 2) => api.get(x, y);
export function e(id: string) {
  log(id);
  return api.get(id);
}
export function g(id: string) {
  return api.get(id).then((v) => v);
}
const h = (id: string) => api.get(id);
export const i = ({ id }: { id: string }) => api.get({ id });
export const j = (...ids: string[]) => api.get(...ids);
export const k = (id: string) => api.get(id) as Promise<string>;
export const l = async (id: string) => await api.get(id);
export const m = (id: string) => (api.get(id), id);
export const n = () => api.get();
