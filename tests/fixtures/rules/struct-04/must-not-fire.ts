// A real seam: two implementers in the file (the symbols adapter counts cross-file implementers too).
export interface IProps { size: number }
export class A implements IProps { size = 1; }
export class B implements IProps { size = 2; }

export interface IClock { now(): number }
export class SystemClock implements IClock { now() { return Date.now(); } }
export class FakeClock implements IClock, Disposable { now() { return 0; } [Symbol.dispose]() {} }

// Not I-prefixed seams: no uppercase-lowercase pair after the I, or not exported.
export interface IDE { name: string }
export interface IOError { code: number }
export interface Icon { name: string }
export interface InternalOptions { a: string }
interface IPrivate { a: string }
// export interface ICommentedOut {}
const s = 'export interface IInString {}';
