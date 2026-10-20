// const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const note = "export function sleep(ms: number) { return ms; }";
export const tpl = `const sleep = () => ${note.length}`;
