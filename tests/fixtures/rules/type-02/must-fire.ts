declare const cfg: { a?: { b?: { c?: string } } };
export const v = cfg.a!.b!.c!;
export const w = cfg!.a!.b;
export const len = (cfg.a!.b!.c ?? '').length;
export const call = getUser()!.profile!.name;
declare function getUser(): { profile?: { name: string } } | undefined;
