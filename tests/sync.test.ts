import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, Repositories } from "@contextforge/database";
import { planExport, applyExport } from "@contextforge/exporters";
import { checkConflictsDeep } from "@contextforge/core";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "am-p5-"));
  const repos = new Repositories(await openDatabase(join(root, "m.db")));
  const p = repos.upsertProject({ name: "demo", rootPath: join(root, "proj") });
  return { repos, projectId: p.id, root: join(root, "proj") };
}

describe("Phase 5: controlled synchronization", () => {
  it("plans all expected agent files and diffs against existing content", async () => {
    const { repos, projectId, root } = await setup();
    const item = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "architecture",
      title: "Translation tables",
      content: "Use only form_locales and form_translations.",
      status: "approved",
      appliesTo: "database/**,app/**",
      sourceType: "feedback",
    });

    // First plan: nothing exists yet.
    const planned1 = planExport(repos, projectId, root);
    const paths1 = planned1.map((f) => f.path);
    expect(paths1.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/copilot-instructions.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/instructions/database-**.instructions.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/instructions/app-**.instructions.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/prompts/review-feedback.prompt.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/agents/project-reviewer.agent.md"))).toBe(true);
    expect(paths1.some((p) => p.endsWith(".github/skills/translation-tables/SKILL.md"))).toBe(true);
    // New files count as changes (otherwise a fresh repo would never get exported).
    expect(planned1.every((f) => !f.exists && f.diff !== null)).toBe(true);

    // Apply, then change the rule and re-plan: diff should be non-null.
    applyExport(planned1);
    repos.updateKnowledgeStatus(item.id, "approved");
    // modify content via a new superseding rule -> change the item content
    repos.createKnowledge({
      projectId,
      scope: "project",
      category: "architecture",
      title: "Translation tables",
      content: "Use ONLY form_locales and form_translations, never a third table.",
      status: "approved",
      appliesTo: "database/**,app/**",
      sourceType: "feedback",
    });
    const planned2 = planExport(repos, projectId, root);
    const agents = planned2.find((f) => f.path.endsWith("AGENTS.md"))!;
    expect(agents.diff).not.toBeNull();
    expect(agents.diff).toContain("+");
  });

  it("does not write without explicit apply", async () => {
    const { repos, projectId, root } = await setup();
    repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "Indentation",
      content: "Use 2 spaces.",
      status: "approved",
      sourceType: "feedback",
    });
    const planned = planExport(repos, projectId, root);
    const agentsPath = planned.find((f) => f.path.endsWith("AGENTS.md"))!.path;
    expect(require("node:fs").existsSync(agentsPath)).toBe(false);
    applyExport(planned);
    expect(require("node:fs").existsSync(agentsPath)).toBe(true);
  });

  it("deep conflict check returns deterministic conflicts and no false semantic hits by default", async () => {
    const { repos, projectId, root } = await setup();
    repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "UUID PK",
      content: "Use uuid primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "Auto PK",
      content: "Use auto-increment primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const result = await checkConflictsDeep(repos, projectId);
    expect(result.deterministic.length).toBe(1);
    // No model configured -> semantic pass declines.
    expect(result.semantic.every((s) => !s.conflict)).toBe(true);
  });

  it("deep conflict check uses a provided model for semantic detection", async () => {
    const { repos, projectId } = await setup();
    const a = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "Transactions",
      content: "Wrap writes in database transactions.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const b = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "No transactions",
      content: "Do not use database transactions for simple inserts.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const model = async () => ({
      conflict: true,
      type: "semantic" as const,
      explanation: "Transactions vs no-transactions.",
      suggestedResolution: "Keep transactions for multi-row writes.",
    });
    const result = await checkConflictsDeep(repos, projectId, { model });
    const hit = result.semantic.find(
      (s) => s.leftItemId === a.id || s.rightItemId === a.id
    );
    expect(hit?.conflict).toBe(true);
    expect(hit?.type).toBe("semantic");
  });
});

describe("export of brand-new files", () => {
  it("plans files that do not exist yet as changes (not 'up to date')", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDatabase, Repositories } = await import("@contextforge/database");
    const { planExport } = await import("@contextforge/exporters");
    const root = mkdtempSync(join(tmpdir(), "cf-newfile-"));
    const repos = new Repositories(await openDatabase(join(root, "m.db")));
    const p = repos.upsertProject({ name: "demo", rootPath: root });
    const planned = planExport(repos, p.id, root);
    const agents = planned.find((f) => f.path.endsWith("AGENTS.md"))!;
    expect(agents.exists).toBe(false);
    expect(agents.diff).toContain("+ # Project Rules");
  });
});
