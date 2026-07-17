const { cpSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const candidates = [
  join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  join(__dirname, "..", "..", "node_modules", ".pnpm", "sql.js@1.14.1", "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
];
const s = candidates.find(existsSync);
const t = join(__dirname, "dist", "sql-wasm.wasm");
if (s) {
  cpSync(s, t);
  console.log("[db] copied sql-wasm.wasm from", s);
} else {
  console.warn("[db] sql-wasm.wasm not found; tried", candidates);
}
