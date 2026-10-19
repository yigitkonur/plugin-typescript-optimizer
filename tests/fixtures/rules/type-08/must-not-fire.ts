// enum Commented { A } and namespace Commented2 { } and constructor(private x: number) are comments
const doc = 'enum Fake { A } namespace Fake { } constructor(private x: number)';
export type Status = 'active' | 'inactive';
export const Dir = { Up: 'up', Down: 'down' } as const;
declare enum Ambient { A }
declare namespace GlobalLib { const v: number; }
declare module 'external-lib' {
  export const x: number;
}
export class Explicit {
  readonly name: string;
  constructor(name: string, opts: { readonly verbose: boolean }) {
    this.name = name;
  }
}
export const schema = z.enum(['a', 'b']);
export const jsonSchema = { enum: ['a', 'b'], type: 'string' };
