// process.env.SECRET must not be read here; use env.SECRET
const note = 'process.env.TOKEN is undefined in workerd';
const tpl = `read ${'x'} process.env.Y`;
export const viaEnv = (env: Env) => env.SUPABASE_URL;
export const meta = import.meta.env.MODE;
export class A {
  constructor(private readonly env: Env) {}
  get url() { return this.env.SUPABASE_URL; }
}
export const processor = { env: 'x' };
export const subprocess = { env: 'y' };
export const e2 = subprocess.env;
