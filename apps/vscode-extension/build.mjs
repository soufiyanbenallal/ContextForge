import { build } from "esbuild";
import { rmSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

rmSync("dist", { recursive: true, force: true });
rmSync(join(__dirname, "better-sqlite3"), { recursive: true, force: true });
mkdirSync(join(__dirname, "dist", "build", "Release"), { recursive: true });
mkdirSync(join(__dirname, "build", "Release"), { recursive: true });

// sql.js is pure WASM (no native addon) — ship the wasm file next to the bundle.
function findWasm() {
  const candidates = [
    join(__dirname, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    join(__dirname, "..", "..", "node_modules", ".pnpm", "sql.js@1.14.1", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const wasm = findWasm();
if (!wasm) {
  console.warn("[build] sql-wasm.wasm not found; extension will fail to load sql.js.");
} else {
  cpSync(wasm, join(__dirname, "dist", "sql-wasm.wasm"));
  console.log("[build] copied sql-wasm.wasm from", wasm);
}

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});
