import { describe, it, expect } from "vitest";
import { openDatabase, Repositories } from "@contextforge/database";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesAppliesTo } from "../apps/vscode-extension/src/glob.js";

describe("rule file matching (globs)", () => {
  it("matches directories, ** and * patterns", () => {
    expect(matchesAppliesTo("app/**,database/**", "app/Models/FormTranslation.php")).toBe(true);
    expect(matchesAppliesTo("app/", "app/x/y.ts")).toBe(true);
    expect(matchesAppliesTo("src/**/*.test.ts", "src/a/b/c.test.ts")).toBe(true);
    expect(matchesAppliesTo("src/**/*.test.ts", "src/a/b/c.ts")).toBe(false);
    expect(matchesAppliesTo("*.md", "README.md")).toBe(true);
    expect(matchesAppliesTo("*.md", "docs/README.md")).toBe(false);
  });
  it("no longer matches by substring and handles Windows separators", () => {
    expect(matchesAppliesTo("app/**", "myapp/file.ts")).toBe(false);
    expect(matchesAppliesTo("app/**", "app\\Models\\A.php")).toBe(true);
    expect(matchesAppliesTo(null, "a.ts")).toBe(false);
  });
});

describe("conflict de-duplication", () => {
  it("re-running detection does not create duplicate open conflicts", async () => {
    const repos = new Repositories(
      await openDatabase(join(mkdtempSync(join(tmpdir(), "cf-p1-")), "m.db"))
    );
    const p = repos.upsertProject({ name: "demo", rootPath: "/tmp/demo-p1" });
    const mk = (title: string) =>
      repos.createKnowledge({
        projectId: p.id, scope: "project", category: "coding-rule",
        title, content: title, status: "approved", sourceType: "manual",
      });
    const a = mk("Use UUID primary keys");
    const b = mk("Use auto-increment primary keys");
    const c1 = repos.createConflict({ projectId: p.id, leftItemId: a.id, rightItemId: b.id, conflictType: "direct" });
    const c2 = repos.createConflict({ projectId: p.id, leftItemId: b.id, rightItemId: a.id, conflictType: "direct" });
    expect(c2.id).toBe(c1.id);
    expect(repos.listConflicts(p.id, "open")).toHaveLength(1);
  });
});
