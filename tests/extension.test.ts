import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "am-ext-"));
const dbPath = join(root, "m.db");
const wsFolder = join(root, "proj");

// Point the vscode stub at our temp workspace/db.
const vscode = await import("vscode");
(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: wsFolder } }];
(vscode.workspace as any).getConfiguration = () => ({
  get: (key: string) => (key === "dbPath" ? dbPath : null),
});

const { createBackend } = await import(
  "../apps/vscode-extension/src/backend.js"
);
const { MemoryTreeProvider } = await import(
  "../apps/vscode-extension/src/tree.js"
);

describe("Phase 3: VS Code extension data glue", () => {
  it("backend resolves current project and tree renders groups", async () => {
    const backend = await createBackend();
    const proj = backend.getCurrentProject();
    expect(proj).not.toBeNull();
    const provider = new MemoryTreeProvider(backend);
    const groups = provider.getChildren();
    expect(groups.length).toBe(4);
    const labels = groups.map((g) => (g.kind === "group" ? g.label : ""));
    expect(labels.some((l) => l.startsWith("Approved rules"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Proposed lessons"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Conflicts"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Skills & MCPs"))).toBe(true);
  });

  it("recording feedback stores a feedback event for the project", async () => {
    const backend = await createBackend();
    const proj = backend.getCurrentProject()!;
    const fb = backend.repos.recordFeedback({
      projectId: proj.projectId,
      feedbackType: "reject",
      message: "Use only form_locales for translations.",
      classification: "violated-architecture",
      severity: "high",
    });
    expect(fb.id).toBeTruthy();
    const list = backend.repos.listFeedback(proj.projectId);
    expect(list.some((f) => f.id === fb.id)).toBe(true);
  });

  it("saving text as a rule creates a proposed knowledge item via the backend", async () => {
    const backend = await createBackend();
    const proj = backend.getCurrentProject()!;
    const item = backend.repos.createKnowledge({
      projectId: proj.projectId,
      scope: "project",
      category: "coding-rule",
      title: "Use only form_locales for translations.",
      content: "Use only form_locales for translations.",
      status: "proposed",
      sourceType: "manual",
    });
    expect(item.status).toBe("proposed");
    const proposed = backend.repos.listKnowledge({
      projectId: proj.projectId,
      status: "proposed",
    });
    expect(proposed.some((i) => i.id === item.id)).toBe(true);
  });
});
