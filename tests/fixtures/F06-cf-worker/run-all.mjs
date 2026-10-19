// Runs one script across every variant: node run-all.mjs <typecheck|test>
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const variantsDir = join(root, "variants");
const script = process.argv[2];
if (script !== "typecheck" && script !== "test") {
  console.error("usage: node run-all.mjs <typecheck|test>");
  process.exit(2);
}

let failed = 0;
for (const name of readdirSync(variantsDir).sort()) {
  console.log(`== npm run ${script}: variants/${name}`);
  const r = spawnSync("npm", ["run", script], { cwd: join(variantsDir, name), stdio: "inherit" });
  if (r.status !== 0) failed = r.status ?? 1;
}
process.exit(failed);
