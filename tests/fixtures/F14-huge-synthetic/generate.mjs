#!/usr/bin/env node
// Deterministic synthetic TypeScript monorepo generator (no dependencies).
// Usage: node generate.mjs <outdir> [fileCount=20000]
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, posix } from "node:path";

const outDir = process.argv[2];
const total = Number.parseInt(process.argv[3] ?? "20000", 10);
if (!outDir || !Number.isInteger(total) || total < 1) {
  console.error("usage: node generate.mjs <outdir> [fileCount=20000]");
  process.exit(2);
}
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`refusing to write into non-empty directory: ${outDir}`);
  process.exit(2);
}

const PKG_SIZE = 500; // .ts files per package
const MOD_SIZE = 20; // .ts files per module dir (position 0 is the barrel)
const DEAD_EVERY = 10; // local index k with k % 10 === 7 is a dead file
const DEAD_EXPORT_EVERY = 10; // live file with k % 10 === 3 also has an unused export

// mulberry32: deterministic PRNG
let seed = 0x5eed14;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = (n, w) => String(n).padStart(w, "0");
const write = (rel, text) => {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const importPath = (fromRel, toRel) => {
  let p = posix.relative(posix.dirname(fromRel), toRel).replace(/\.ts$/, "");
  if (!p.startsWith(".")) p = "./" + p;
  return p;
};

const counts = { files: 0, packages: 0, barrels: 0, live_files: 0, dead_files: 0, entries: 0, unused_exports: 0, edges: 0 };
const pkgCount = Math.ceil(total / PKG_SIZE);

for (let pk = 0; pk < pkgCount; pk++) {
  counts.packages++;
  const size = Math.min(PKG_SIZE, total - pk * PKG_SIZE);
  const modCount = Math.ceil(size / MOD_SIZE);
  const gid = (k) => pk * PKG_SIZE + k;
  const name = (k) => `f${pad(gid(k), 6)}`;
  const rel = (k) =>
    `packages/pkg-${pad(pk, 3)}/src/mod-${pad(Math.floor(k / MOD_SIZE), 2)}/${k % MOD_SIZE === 0 ? "index" : name(k)}.ts`;
  const kind = (k) => (k % MOD_SIZE === 0 ? "barrel" : k % DEAD_EVERY === 7 ? "dead" : "live");

  // entry = highest-k live file of the package; nothing imports it
  let entryK = -1;
  for (let k = size - 1; k >= 0; k--) if (kind(k) === "live") { entryK = k; break; }

  // members[m] = live non-entry files of module m (exported through barrel m)
  const members = [];
  for (let m = 0; m < modCount; m++) {
    members[m] = [];
    for (let k = m * MOD_SIZE; k < Math.min(size, (m + 1) * MOD_SIZE); k++)
      if (kind(k) === "live" && k !== entryK) members[m].push(k);
  }

  const liveSoFar = []; // live non-entry files with lower k
  for (let m = 0; m < modCount; m++) {
    const lo = m * MOD_SIZE;
    const hi = Math.min(size, lo + MOD_SIZE);
    let barrelImportPending = m > 0 && members[m - 1].length > 0;
    for (let k = lo + 1; k < hi; k++) {
      const kd = kind(k);
      const myRel = rel(k);
      const lines = [];
      const deps = [];
      const addImport = (target, from) => {
        const nm = name(target);
        if (deps.includes(nm)) return;
        lines.push(`import { ${nm} } from "${importPath(myRel, from)}";`);
        deps.push(nm);
        counts.edges++;
      };
      if (kd !== "dead" && barrelImportPending) {
        // first live file of module m imports module m-1 via its barrel
        addImport(members[m - 1][0], rel((m - 1) * MOD_SIZE));
        barrelImportPending = false;
      }
      if (k === entryK && members[modCount - 1].length > 0 && modCount - 1 !== m - 1) {
        addImport(members[modCount - 1][0], rel((modCount - 1) * MOD_SIZE));
      }
      const want = kd === "dead" ? 1 : 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < want && liveSoFar.length; i++) {
        const win = Math.min(60, liveSoFar.length);
        const t = liveSoFar[liveSoFar.length - 1 - Math.floor(rnd() * win)];
        addImport(t, rel(t));
      }
      lines.push("");
      lines.push(`export function ${name(k)}(x: number): number {`);
      lines.push(`  return x + ${gid(k) % 97}${deps.map((d) => ` + ${d}(x)`).join("")};`);
      lines.push("}");
      if (kd === "live" && k % DEAD_EXPORT_EVERY === 3) {
        lines.push("", `export const unused${pad(gid(k), 6)} = ${gid(k)};`);
        counts.unused_exports++;
      }
      write(myRel, lines.join("\n") + "\n");
      counts.files++;
      if (kd === "dead") counts.dead_files++;
      else {
        counts.live_files++;
        if (k === entryK) counts.entries++;
        else liveSoFar.push(k);
      }
    }
    const exportsText = members[m].map((k) => `export { ${name(k)} } from "./${name(k)}";`);
    write(rel(lo), (exportsText.length ? exportsText.join("\n") : "export {};") + "\n");
    counts.files++;
    counts.barrels++;
  }
}

write("package.json", JSON.stringify({
  name: "f14-huge-synthetic", version: "1.0.0", private: true, type: "module",
  scripts: { typecheck: "tsc --noEmit" },
  devDependencies: { typescript: "5.9.3" },
}, null, 2) + "\n");
write("tsconfig.json", JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true },
  include: ["packages/*/src"],
}, null, 2) + "\n");
write("generated.json", JSON.stringify({ generator: "F14 generate.mjs", requested: total, ...counts }, null, 2) + "\n");
console.log(JSON.stringify({ outDir, ...counts }));
