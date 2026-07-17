import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
    alias: {
      vscode: resolve(__dirname, "vscode-stub.ts"),
    },
  },
});
