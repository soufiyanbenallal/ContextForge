#!/usr/bin/env bash
#
# Agent Memory — getting started
# Builds the monorepo, registers the current repo as a project, and shows the
# MCP server command + a ready-to-use .mcp.json snippet.
#
# Usage:
#   ./scripts/start-here.sh            # from any repo you want to track
#   AGENT_MEMORY_DB=/path/to/m.db ./scripts/start-here.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/index.js"
SERVER="$ROOT/packages/mcp-server/dist/server.js"
DB="${AGENT_MEMORY_DB:-$HOME/.agent-memory/memory.db}"

echo "==> Building Agent Memory..."
( cd "$ROOT" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
( cd "$ROOT" && pnpm -r build )

TARGET="$(pwd)"
echo "==> Registering project: $TARGET"
node "$CLI" init --db "$DB" --project "$TARGET" || true

echo
echo "==> Agent Memory is ready."
echo
echo "MCP server entrypoint:"
echo "    node $SERVER"
echo
echo "Add this to the tracked repo's .mcp.json (or your client config):"
echo
cat <<JSON
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["$SERVER"],
      "env": { "AGENT_MEMORY_DB": "$DB" }
    }
  }
}
JSON
echo
echo "Typical daily loop:"
echo "  agent-memory feedback --type reject --message \"...\" --classification violated-architecture"
echo "  agent-memory propose  --feedback <id> --scope project --appliesTo \"app/**\""
echo "  agent-memory approve  --id <knowledgeId>"
echo "  agent-memory export --apply   # writes AGENTS.md + .github/* after a diff"
