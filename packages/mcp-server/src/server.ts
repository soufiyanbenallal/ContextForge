import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ServerContext, createServerContext } from "./context.js";
import { toolSchemas, handleTool } from "./tools/index.js";
import { listResourceTemplates, readResource } from "./resources/index.js";
import { getContext } from "@contextforge/core";
import { resolveProject } from "./context.js";

export function buildServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: "contextforge",
    version: "0.1.0",
  });

  for (const [toolName, schema] of Object.entries(toolSchemas)) {
    server.tool(toolName, schema as Record<string, z.ZodType>, async (args: Record<string, unknown>) =>
      handleTool(ctx, toolName, args)
    );
  }

  for (const tpl of listResourceTemplates()) {
    server.resource(tpl.name, tpl.uriTemplate, async (uri: URL) => {
      const entry = readResource(ctx, uri.href);
      if (!entry) {
        return {
          contents: [{ uri: uri.href, text: "Not found", mimeType: "application/json" }],
        };
      }
      return {
        contents: [{ uri: entry.uri, text: entry.text, mimeType: "application/json" }],
      };
    });
  }

  // Proactive-prevention prompt: returns a briefing of approved lessons the
  // agent should honor for the current task before acting.
  server.prompt(
    "contextforge_brief",
    {
      task: z.string().optional().describe("What you are about to do"),
      files: z.array(z.string()).optional().describe("Files you will touch"),
      projectPath: z.string().optional(),
    },
    async (args: { task?: string; files?: string[]; projectPath?: string }) => {
      const { projectId } = resolveProject(ctx, args.projectPath);
      const c = getContext(ctx.repos, {
        projectId,
        task: args.task,
        files: args.files,
      });
      const lines: string[] = [];
      lines.push("# ContextForge memory briefing");
      if (c.requiredRules.length)
        lines.push("\n## Required rules (must follow):\n" + c.requiredRules.map((r) => `- ${r.content}`).join("\n"));
      if (c.failedApproaches.length)
        lines.push("\n## Failed approaches (avoid):\n" + c.failedApproaches.map((r) => `- ${r.content}`).join("\n"));
      if (c.warnings.length) lines.push("\n## Warnings:\n" + c.warnings.map((w) => `- ${w}`).join("\n"));
      if (lines.length === 1) lines.push("\nNo relevant approved memory for this task.");
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: lines.join("\n") },
          },
        ],
      };
    }
  );

  return server;
}

import { z } from "zod";

export async function startServer(dbPath?: string): Promise<void> {
  const ctx = await createServerContext(dbPath);
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.CONTEXTFORGE_DB;
  startServer(dbPath ?? undefined).catch((err) => {
    console.error("Failed to start ContextForge MCP server:", err);
    process.exit(1);
  });
}
