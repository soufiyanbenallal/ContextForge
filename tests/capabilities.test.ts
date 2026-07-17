import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { openDatabase, Repositories } from "@contextforge/database";
import {
  discoverCapabilities,
  syncCapabilities,
  validateAllCapabilities,
  recommendCapabilities,
} from "@contextforge/core";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "am-p4-"));
  const repos = new Repositories(await openDatabase(join(root, "m.db")));
  const p = repos.upsertProject({ name: "demo", rootPath: join(root, "proj") });
  return { repos, projectId: p.id, root: join(root, "proj") };
}

describe("Phase 4: capability manager", () => {
  it("discovers skills and mcp servers from a repo", async () => {
    const { root } = await setup();
    mkdirSync(join(root, ".github", "skills", "shopify-dev"), { recursive: true });
    writeFileSync(
      join(root, ".github", "skills", "shopify-dev", "SKILL.md"),
      "# Shopify Dev\nSearch Shopify developer documentation and GraphQL."
    );
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "db-mcp": {
            description: "Database MCP server",
            env: { DB_TOKEN: { required: true } },
          },
        },
      })
    );

    const found = discoverCapabilities(root);
    const names = found.map((f) => f.name).sort();
    expect(names).toContain("shopify-dev");
    expect(names).toContain("db-mcp");
    const mcp = found.find((f) => f.name === "db-mcp");
    expect(mcp?.type).toBe("mcp");
    expect(Object.keys(mcp?.requiredConfig ?? {})).toContain("DB_TOKEN");
  });

  it("syncs discovered capabilities into the registry", async () => {
    const { repos, projectId, root } = await setup();
    mkdirSync(join(root, ".github", "skills", "laravel"), { recursive: true });
    writeFileSync(
      join(root, ".github", "skills", "laravel", "SKILL.md"),
      "# Laravel\nLaravel backend helpers and Eloquent patterns."
    );
    const result = syncCapabilities(repos, root, projectId);
    expect(result.added.length).toBe(1);
    expect(repos.getCapabilityByName("laravel")?.type).toBe("skill");
  });

  it("flags missing required config and reports it", async () => {
    const { repos, projectId, root } = await setup();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "secret-mcp": { env: { API_KEY: { required: true } } },
        },
      })
    );
    syncCapabilities(repos, root, projectId);
    const report = validateAllCapabilities(repos);
    const issue = report.find((r) => r.capability.name === "secret-mcp");
    expect(issue?.valid).toBe(false);
    expect(issue?.missing).toContain("API_KEY");

    // Provide the config, re-validate.
    const cap = issue!.capability;
    repos.setCapabilityConfig(cap.id, JSON.stringify({ API_KEY: "xyz" }));
    const after = validateAllCapabilities(repos).find(
      (r) => r.capability.name === "secret-mcp"
    );
    expect(after?.valid).toBe(true);
  });

  it("recommends capabilities for a task and reports conflicts/config issues", async () => {
    const { repos, projectId, root } = await setup();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "shopify-mcp": { description: "Shopify GraphQL MCP" },
        },
      })
    );
    syncCapabilities(repos, root, projectId);
    const report = recommendCapabilities(repos, {
      task: "query shopify products via graphql",
      projectId,
    });
    expect(report.recommended.length).toBeGreaterThan(0);
    expect(
      report.recommended.some((r) => r.capability.name === "shopify-mcp")
    ).toBe(true);
  });

  it("tracks usage and updates success rate", async () => {
    const { repos, projectId, root } = await setup();
    mkdirSync(join(root, ".github", "skills", "lint"), { recursive: true });
    writeFileSync(join(root, ".github", "skills", "lint", "SKILL.md"), "# Lint\nLinting helpers.");
    const synced = syncCapabilities(repos, root, projectId);
    const cap = synced.added[0]!;
    repos.recordUsage({ capabilityId: cap.id, outcome: "success", score: 1 });
    repos.recordUsage({ capabilityId: cap.id, outcome: "failure", score: 0 });
    const updated = repos.getCapability(cap.id);
    expect(updated?.successRate).toBeCloseTo(0.5, 5);
  });
});
