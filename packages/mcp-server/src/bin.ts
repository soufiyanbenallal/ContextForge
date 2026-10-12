import { startServer } from "./server.js";

// Bundled entry point (used by the VS Code extension's "Connect agents").
startServer(process.env.CONTEXTFORGE_DB || undefined).catch((err) => {
  console.error("Failed to start ContextForge MCP server:", err);
  process.exit(1);
});
