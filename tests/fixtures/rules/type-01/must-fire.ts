// laundering fixtures: every flagged line below is real code
declare const rawBody: string;
export const payload = JSON.parse(rawBody) as any;
export const theme = { primary: '#0070f3' } as unknown as ThemeConfig;
export const legacy = <any>globalThis;
export function idOf(x: unknown) { return (x as any).id; }
interface ThemeConfig { primary: string }
