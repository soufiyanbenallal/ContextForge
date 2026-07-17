import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, Repositories } from "@contextforge/database";
import { detectProject, getContext, detectConflicts, extractLesson, proposeLessonFromFeedback } from "@contextforge/core";
import { renderAgentsMd } from "@contextforge/exporters";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeRepos(): { repos: Repositories; root: string } {
  const root = mkdtempSync(join(tmpdir(), "am-test-"));
  const db = await openDatabase(join(root, "m.db"));
  return { repos: new Repositories(db), root };
}

describe("project detection + feedback -> lesson -> approve", () => {
  it("stores feedback and produces an approved rule", async () => {
    const { repos } = await makeRepos();
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo" });
    const fb = repos.recordFeedback({
      projectId: p.id,
      feedbackType: "reject",
      message: "Use only form_locales and form_translations.",
      classification: "violated-architecture",
      severity: "high",
    });
    const { item: lesson } = proposeLessonFromFeedback(repos, fb.id, { scope: "project" });
    expect(lesson.status).toBe("proposed");
    const approved = repos.updateKnowledgeStatus(lesson.id, "approved");
    expect(approved?.status).toBe("approved");
    expect(approved?.sourceId).toBe(fb.id);
  });
});

describe("conflict detection", () => {
  it("detects contradictory primary-key rules", async () => {
    const { repos } = await makeRepos();
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo2" });
    const a = repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "coding-rule",
      title: "Use UUID PK",
      content: "All tables must use uuid primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const b = repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "coding-rule",
      title: "Use auto-increment PK",
      content: "Use auto-increment primary keys for all tables.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const conflicts = detectConflicts(repos, p.id);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.conflictType).toBe("direct");
  });

  it("does not flag unrelated rules", async () => {
    const { repos } = await makeRepos();
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo3" });
    repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "coding-rule",
      title: "Use UUID PK",
      content: "All tables must use uuid primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "user-preference",
      title: "Prefer tabs",
      content: "Indentation should use tabs.",
      status: "approved",
      sourceType: "feedback",
    });
    expect(detectConflicts(repos, p.id).length).toBe(0);
  });
});

describe("retrieval", () => {
  it("returns approved rules relevant to a file", async () => {
    const { repos } = await makeRepos();
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo4" });
    repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "architecture",
      title: "Translation tables",
      content: "Use only form_locales and form_translations.",
      status: "approved",
      appliesTo: "database/**,app/**",
      sourceType: "feedback",
    });
    const ctx = getContext(repos, {
      projectId: p.id,
      files: ["database/migrations/translations.sql"],
    });
    expect(ctx.relevantDecisions.length).toBe(1);
  });
});

describe("exporters", () => {
  it("renders AGENTS.md from approved items", async () => {
    const { repos } = await makeRepos();
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo5" });
    repos.createKnowledge({
      projectId: p.id,
      scope: "project",
      category: "architecture",
      title: "Translation tables",
      content: "Use only form_locales and form_translations.",
      status: "approved",
      sourceType: "feedback",
    });
    const items = repos.listKnowledge({ projectId: p.id, status: "approved" });
    const md = renderAgentsMd(items);
    expect(md).toContain("# Project Rules");
    expect(md).toContain("form_locales");
  });
});
