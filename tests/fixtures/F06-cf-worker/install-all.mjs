// Installs every wrangler variant (each is its own npm package with its own lockfile).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const variantsDir = join(root, "variants");

for (const name of readdirSync(variantsDir).sort()) {
  console.log(`== npm ci: variants/${name}`);
  const r = spawnSync("npm", ["ci"], { cwd: join(variantsDir, name), stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
