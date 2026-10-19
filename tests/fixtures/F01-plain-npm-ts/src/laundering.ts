import type { Settings } from "./types.ts";

// This comment mentions `as any` but is only prose.
export const note = "casting with as any is discouraged";

export function loadSettings(raw: string): Settings {
  const parsed = JSON.parse(raw) as any;
  return parsed;
}

export function coerceSettings(value: object): Settings {
  return value as unknown as Settings;
}

// decoy: optional chains on parsed external JSON are legitimate
export function deepName(raw: string): string | undefined {
  const data = JSON.parse(raw);
  return data?.profile?.owner?.name;
}
