import { Repositories } from "@contextforge/database";
import { CapabilityRecord } from "@contextforge/shared";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredCapability {
  type: "skill" | "mcp";
  name: string;
  description: string | null;
  source: string;
  taskPatterns: string[];
  requiredConfig: Record<string, unknown>;
}

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function discoverCapabilities(projectPath: string): DiscoveredCapability[] {
  const found: DiscoveredCapability[] = [];

  // VS Code / GitHub skills: .github/skills/<name>/SKILL.md
  const skillsDir = join(projectPath, ".github", "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillMd = join(skillsDir, entry, "SKILL.md");
      if (existsSync(skillMd)) {
        const body = readFileSync(skillMd, "utf8");
        found.push({
          type: "skill",
          name: entry,
          description: firstSentence(body),
          source: skillMd,
          taskPatterns: extractKeywords(body),
          requiredConfig: {},
        });
      }
    }
  }

  // MCP servers: .mcp.json or mcp.json
  for (const file of [".mcp.json", "mcp.json"]) {
    const p = join(projectPath, file);
    if (!existsSync(p)) continue;
    const cfg = readJson(p);
    if (!cfg || !cfg.mcpServers) break;
    for (const [name, def] of Object.entries<any>(cfg.mcpServers)) {
      const requiredConfig: Record<string, unknown> = {};
      const env = def?.env ?? {};
      for (const [k, v] of Object.entries<any>(env)) {
        if (v && typeof v === "object" && v.required) requiredConfig[k] = true;
      }
      found.push({
        type: "mcp",
        name,
        description: def?.description ?? null,
        source: p,
        taskPatterns: extractKeywords((def?.description ?? "") + " " + name),
        requiredConfig,
      });
    }
  }

  return found;
}

function firstSentence(md: string): string | null {
  const desc = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && !l.startsWith("#"));
  return desc.length ? desc[0]!.slice(0, 120) : null;
}

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3)
    )
  ).slice(0, 8);
}

export function syncCapabilities(
  repos: Repositories,
  projectPath: string,
  projectId: string | null
): { added: CapabilityRecord[]; updated: number } {
  const discovered = discoverCapabilities(projectPath);
  const added: CapabilityRecord[] = [];
  let updated = 0;
  for (const d of discovered) {
    const existing = repos.getCapabilityByName(d.name);
    const rec = repos.upsertCapability({
      type: d.type,
      name: d.name,
      description: d.description,
      source: d.source,
      taskPatterns: d.taskPatterns,
      requiredConfig: d.requiredConfig,
      projects: projectId ? [projectId] : [],
    });
    if (existing) updated++;
    else added.push(rec);
  }
  return { added, updated };
}

export interface CapabilityValidation {
  capability: CapabilityRecord;
  valid: boolean;
  missing: string[];
}

export function validateAllCapabilities(
  repos: Repositories
): CapabilityValidation[] {
  return repos.listCapabilities().map((c) => {
    const v = repos.validateCapabilityConfig(c.id);
    return { capability: c, valid: v.valid, missing: v.missing };
  });
}
