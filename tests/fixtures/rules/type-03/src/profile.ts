// no validator library imported: `object(` is just a local function here
declare function object(shape: Record<string, string>): unknown;

export const ProfileSchema = object({ name: "string" });

export interface Profile {
  name: string;
}
