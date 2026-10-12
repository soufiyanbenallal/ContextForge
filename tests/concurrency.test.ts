import { describe, it, expect } from "vitest";
import { openDatabase, Repositories } from "@contextforge/database";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression test for the "extension and MCP server don't share data" bug:
// two handles on the same DB file (like the VS Code extension and the MCP
// server) must see each other's writes and must not clobber each other.
describe("concurrent database handles", () => {
  it("both handles see all writes, none are lost", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "cf-conc-")), "m.db");
    const ext = new Repositories(await openDatabase(path));
    const mcp = new Repositories(await openDatabase(path));

    const p = ext.upsertProject({ name: "demo", rootPath: "/tmp/demo-conc" });
    // The MCP side writes after the extension has already opened its handle.
    const fb = mcp.recordFeedback({
      projectId: p.id,
      feedbackType: "reject",
      message: "written by mcp",
    });
    // The extension then writes something else.
    ext.recordFeedback({
      projectId: p.id,
      feedbackType: "accept",
      message: "written by extension",
    });

    const fromExt = ext.listFeedback(p.id, 50).map((f) => f.message).sort();
    const fromMcp = mcp.listFeedback(p.id, 50).map((f) => f.message).sort();
    expect(fb.id).toBeTruthy();
    expect(fromExt).toEqual(["written by extension", "written by mcp"]);
    expect(fromMcp).toEqual(fromExt);
  });
});

describe("concurrent processes", () => {
  it("4 processes x 10 writes -> 40 rows, nothing lost", async () => {
    const { spawn } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const dbEntry = createRequire(import.meta.url).resolve("@contextforge/database");
    const path = join(mkdtempSync(join(tmpdir(), "cf-proc-")), "m.db");
    const seed = new Repositories(await openDatabase(path));
    const p = seed.upsertProject({ name: "demo", rootPath: "/tmp/demo-proc" });

    const script = `
      import(${JSON.stringify(dbEntry)}).then(async (m) => {
        const r = new m.Repositories(await m.openDatabase(${JSON.stringify(path)}));
        for (let i = 0; i < 10; i++)
          r.recordFeedback({ projectId: ${JSON.stringify(p.id)}, feedbackType: "reject", message: process.pid + ":" + i });
      });`;
    await Promise.all(
      [0, 1, 2, 3].map(
        () =>
          new Promise<void>((resolve, reject) => {
            const c = spawn(process.execPath, ["-e", script], { stdio: "inherit" });
            c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
          })
      )
    );
    const check = new Repositories(await openDatabase(path));
    expect(check.listFeedback(p.id, 500)).toHaveLength(40);
  });
});
