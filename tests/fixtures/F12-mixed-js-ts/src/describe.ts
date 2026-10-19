import Registry = require("./registry");

export function describe(r: InstanceType<typeof Registry>): string {
  const v = r.get("a");
  return `${r.name}:${v ?? "none"}`;
}
