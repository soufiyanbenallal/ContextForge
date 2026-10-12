import { describe, it, expect } from "vitest";
import { openDatabase, Repositories } from "@contextforge/database";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildState, applyAction, teach } from "../apps/vscode-extension/src/service.js";
import { planConnect, verifyServer } from "../apps/vscode-extension/src/connect.js";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "cf-inbox-"));
  const repos = new Repositories(await openDatabase(join(root, "m.db")));
  const p = repos.upsertProject({ name: "demo", rootPath: root });
  return { repos, project: { projectId: p.id, rootPath: root }, root };
}

describe("Inbox service", () => {
  it("teach() creates a proposed, scoped lesson with a clean title", async () => {
    const { repos, project } = await setup();
    const r = teach(repos, project.projectId, {
      message: "Never add a third translation table.",
      appliesTo: "app/**",
      evidence: "CREATE TABLE x_translations (...)",
    });
    const state = buildState(repos, project);
    expect(state.proposed).toHaveLength(1);
    const item = state.proposed[0]!;
    expect(item.id).toBe(r.itemId);
    expect(item.content).toBe("Never add a third translation table.");
    expect(item.appliesTo).toBe("app/**");
    expect(item.sourceMessage).toContain("Example of the mistake");
  });

  it("approve / reject / undo round-trip", async () => {
    const { repos, project } = await setup();
    const a = teach(repos, project.projectId, { message: "Rule A" });
    const b = teach(repos, project.projectId, { message: "Rule B" });
    const ap = applyAction(repos, { act: "approve", ids: [a.itemId] });
    applyAction(repos, { act: "reject", ids: [b.itemId], reason: "Too broad" });
    let s = buildState(repos, project);
    expect(s.approved.map((r) => r.id)).toEqual([a.itemId]);
    expect(s.history[0]!.rejectedReason).toBe("Too broad");
    expect(s.proposed).toHaveLength(0);
    applyAction(repos, ap.undo!);
    s = buildState(repos, project);
    expect(s.proposed.map((r) => r.id)).toEqual([a.itemId]);
  });

  it("edit & approve changes text and keeps history", async () => {
    const { repos, project } = await setup();
    const a = teach(repos, project.projectId, { message: "use tabs" });
    applyAction(repos, { act: "edit", id: a.itemId, content: "Use tabs, not spaces.", appliesTo: "src/**", approve: true });
    const item = repos.getKnowledge(a.itemId)!;
    expect(item.status).toBe("approved");
    expect(item.content).toBe("Use tabs, not spaces.");
    expect(item.appliesTo).toBe("src/**");
    expect(repos.listVersions(a.itemId).length).toBeGreaterThan(1);
    expect(() => applyAction(repos, { act: "edit", id: a.itemId, content: "  " })).toThrow();
  });

  it("resolving a conflict with 'left' supersedes the loser", async () => {
    const { repos, project } = await setup();
    const mk = (c: string) => {
      const t = teach(repos, project.projectId, { message: c });
      applyAction(repos, { act: "approve", ids: [t.itemId] });
      return t.itemId;
    };
    const a = mk("Use UUID primary keys");
    const b = mk("Use auto-increment primary keys");
    const c = repos.createConflict({ projectId: project.projectId, leftItemId: a, rightItemId: b, conflictType: "direct", explanation: "pk" });
    expect(buildState(repos, project).conflicts).toHaveLength(1);
    // Proposing already detected this pair; our createConflict de-duplicated
    // into it, so use the stored left/right order.
    applyAction(repos, { act: "resolve", id: c.id, winner: "left" });
    expect(repos.getKnowledge(c.leftItemId)!.status).toBe("approved");
    expect(repos.getKnowledge(c.rightItemId)!.status).toBe("superseded");
    expect(buildState(repos, project).conflicts).toHaveLength(0);
  });

  it("supersede replaces an approved rule", async () => {
    const { repos, project } = await setup();
    const t = teach(repos, project.projectId, { message: "old" });
    applyAction(repos, { act: "approve", ids: [t.itemId] });
    applyAction(repos, { act: "supersede", id: t.itemId, content: "new rule" });
    const s = buildState(repos, project);
    expect(s.approved.map((r) => r.content)).toEqual(["new rule"]);
    expect(repos.getKnowledge(t.itemId)!.status).toBe("superseded");
  });
});

describe("Connect agents", () => {
  it("merges into existing MCP config without dropping other servers", async () => {
    const { root } = await setup();
    mkdirSync(join(root, ".vscode"));
    writeFileSync(join(root, ".vscode/mcp.json"), JSON.stringify({ servers: { other: { command: "x" } } }));
    const plan = planConnect(root, ["vscode", "claude-code"], "/srv/mcp.cjs", "/db/m.db");
    const vs = JSON.parse(plan[0]!.content);
    expect(vs.servers.other).toEqual({ command: "x" });
    expect(vs.servers.contextforge).toMatchObject({ type: "stdio", command: "node", args: ["/srv/mcp.cjs"] });
    const cc = JSON.parse(plan[1]!.content);
    expect(cc.mcpServers.contextforge.env.CONTEXTFORGE_DB).toBe("/db/m.db");
    // idempotent: planning against the written result reports no change
    writeFileSync(plan[1]!.path, plan[1]!.content);
    expect(planConnect(root, ["claude-code"], "/srv/mcp.cjs", "/db/m.db")[0]!.changed).toBe(false);
  });

  it("rejects invalid JSON instead of clobbering it", async () => {
    const { root } = await setup();
    writeFileSync(join(root, ".mcp.json"), "{ // comment");
    expect(() => planConnect(root, ["claude-code"], "/s", "/d")).toThrow(/not valid JSON/);
  });

  const bundled = resolve(__dirname, "../apps/vscode-extension/dist/mcp-server.cjs");
  it.skipIf(!existsSync(bundled))("bundled MCP server completes an initialize handshake", async () => {
    const { root } = await setup();
    const res = await verifyServer(bundled, join(root, "srv.db"));
    expect(res.ok, res.detail).toBe(true);
  });

  it.skipIf(!existsSync(bundled))("an agent's MCP write shows up in a second handle (live-refresh data path)", async () => {
    const { root } = await setup();
    const dbPath = join(root, "shared.db");
    const ext = new Repositories(await openDatabase(dbPath));
    const proj = ext.upsertProject({ name: "demo", rootPath: root });
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [bundled], { env: { ...process.env, CONTEXTFORGE_DB: dbPath } });
    const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
    let buf = "";
    const waitFor = (id: number) =>
      new Promise<any>((res, rej) => {
        const t = setTimeout(() => rej(new Error("timeout " + id)), 8000);
        const on = (d: Buffer) => {
          buf += String(d);
          for (const l of buf.split("\n")) {
            if (!l.trim()) continue;
            try { const j = JSON.parse(l); if (j.id === id) { clearTimeout(t); child.stdout.off("data", on); res(j); } } catch {}
          }
        };
        child.stdout.on("data", on);
      });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    await waitFor(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_record_feedback", arguments: { projectPath: root, feedbackType: "reject", message: "from the agent" } } });
    const r = await waitFor(2);
    child.kill();
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    expect(r.result?.isError, JSON.stringify(r)).toBeFalsy();
    expect(ext.listFeedback(proj.id, 10).map((f) => f.message)).toContain("from the agent");
  });
});
