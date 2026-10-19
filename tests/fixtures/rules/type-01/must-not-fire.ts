// a cast such as `value as any` inside a line comment must not fire
/* const x = y as any; and also <any>z and a as unknown as Foo */
const msg = 'casting with as any is banned';
const tpl = `use <any>x never ${1 + 1} as unknown as Foo`;
export type Loose = Array<any>;
export type M = Map<string, any>;
export const ok = JSON.parse('{}') as unknown;
import { a as anything } from './a';
export const k = 1 as const;
export const n = anything as number;
