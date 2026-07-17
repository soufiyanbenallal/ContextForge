import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, Repositories } from "@contextforge/database";
import {
  proposeLessonFromFeedback,
  supersedeRule,
  detectConflicts,
  conflictsWithCandidate,
} from "@contextforge/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "am-p2-"));
  const repos = new Repositories(await openDatabase(join(root, "m.db")));
  const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo-p2" });
  return { repos, projectId: p.id };
}

describe("Phase 2: lesson lifecycle", () => {
  it("supersedes an old rule and links both records", async () => {
    const { repos, projectId } = await setup();
    const fb1 = repos.recordFeedback({
      projectId,
      feedbackType: "reject",
      message: "Use auto-increment primary keys.",
      classification: "incorrect-code",
    });
    const old = proposeLessonFromFeedback(repos, fb1.id).item;
    repos.updateKnowledgeStatus(old.id, "approved");

    const fb2 = repos.recordFeedback({
      projectId,
      feedbackType: "correction",
      message: "Actually use UUID primary keys.",
      classification: "incorrect-code",
    });
    const next = proposeLessonFromFeedback(repos, fb2.id).item;
    repos.updateKnowledgeStatus(next.id, "approved");

    const result = supersedeRule(repos, old.id, next.id, "Switched to UUID");
    expect(result.old.status).toBe("superseded");
    expect(result.old.supersededBy).toBe(next.id);
    expect(result.next.supersedes).toBe(old.id);
  });

  it("records a version snapshot per change", async () => {
    const { repos, projectId } = await setup();
    const fb = repos.recordFeedback({
      projectId,
      feedbackType: "reject",
      message: "Indent with 2 spaces.",
      classification: "other",
    });
    const item = proposeLessonFromFeedback(repos, fb.id).item;
    repos.updateKnowledgeStatus(item.id, "approved");
    const versions = repos.listVersions(item.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0]!.status).toBe("proposed");
    expect(versions[versions.length - 1]!.status).toBe("approved");
  });

  it("flags conflicts at proposal time against an approved rule", async () => {
    const { repos, projectId } = await setup();
    const a = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "UUID PK",
      content: "Use uuid primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const fb = repos.recordFeedback({
      projectId,
      feedbackType: "reject",
      message: "Use auto-increment primary keys.",
      classification: "incorrect-code",
    });
    const { item, conflicts } = proposeLessonFromFeedback(repos, fb.id, {
      appliesTo: "database/**",
    });
    expect(item.status).toBe("proposed");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.rightItemId).toBe(a.id);
  });

  it("resolves a conflict and supersedes the losing rule", async () => {
    const { repos, projectId } = await setup();
    const a = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "UUID PK",
      content: "Use uuid primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const b = repos.createKnowledge({
      projectId,
      scope: "project",
      category: "coding-rule",
      title: "Auto-increment PK",
      content: "Use auto-increment primary keys.",
      status: "approved",
      appliesTo: "database/**",
      sourceType: "feedback",
    });
    const detected = detectConflicts(repos, projectId);
    expect(detected.length).toBe(1);
    const conflictId = repos.createConflict({
      projectId,
      leftItemId: detected[0]!.leftItemId,
      rightItemId: detected[0]!.rightItemId,
      conflictType: "direct",
      explanation: detected[0]!.explanation,
    }).id;
    const resolved = repos.resolveConflict(conflictId, "Keep UUID", b.id, null);
    expect(resolved?.status).toBe("resolved");
    expect(repos.getKnowledge(b.id)?.status).toBe("superseded");
    expect(repos.getKnowledge(a.id)?.status).toBe("approved");
  });

  it("rejects a lesson with a reason and keeps source feedback", async () => {
    const { repos, projectId } = await setup();
    const fb = repos.recordFeedback({
      projectId,
      feedbackType: "reject",
      message: "Do not memoize selectors.",
      classification: "other",
    });
    const { item } = proposeLessonFromFeedback(repos, fb.id);
    const rejected = repos.updateKnowledgeStatus(item.id, "rejected", {
      reason: "Too specific to one file",
    });
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.rejectedReason).toBe("Too specific to one file");
    expect(rejected?.sourceId).toBe(fb.id);
  });
});
