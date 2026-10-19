// interface Commented extends Record<string, any> {} and type X = string; are comments
const s = 'interface A extends Record<string, any> {}';
interface Safe extends Record<string, unknown> {
  theme: 'dark' | 'light';
}
interface Settings {
  theme: 'dark' | 'light';
  metadata?: Record<string, unknown>;
}
interface WithMembers extends Base {
  extra: number;
}
interface Base { id: string }
export type UserId = string & { readonly __brand: unique symbol };
type Pair = [string, number];
type Handler = (e: Event) => void;
type Id = string | number;
type Wide = string
  | number;
export type Req =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'error'; error: Error };
export type Loose = Record<string, any>;
