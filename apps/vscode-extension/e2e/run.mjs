// Launches a real VS Code, loads this extension, and runs e2e/suite with mocha.
// Usage: pnpm --filter contextforge-vscode test:e2e   (on Linux CI: xvfb-run -a …)
import { runTests } from "@vscode/test-electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, "..");
const extensionTestsPath = resolve(here, "suite", "index.cjs");

// Isolated workspace + database so the test never touches the user's memory.
const root = mkdtempSync(join(tmpdir(), "cf-e2e-"));
const workspace = join(root, "proj");
mkdirSync(join(workspace, ".vscode"), { recursive: true });
mkdirSync(join(workspace, "app"), { recursive: true });
writeFileSync(join(workspace, "app", "model.ts"), "export const x = 1;\n");
writeFileSync(
  join(workspace, ".vscode", "settings.json"),
  JSON.stringify({ "contextforge.dbPath": join(root, "memory.db") }, null, 2)
);
execSync("git init -q", { cwd: workspace });

try {
  await runTests({
    version: process.env.VSCODE_VERSION || "stable",
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: { CF_E2E_ROOT: root, CF_E2E_WORKSPACE: workspace },
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir",
      join(root, "user-data"),
    ],
  });
} catch (err) {
  console.error("E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
