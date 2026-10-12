const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const vscode = require("vscode");

const WS = process.env.CF_E2E_WORKSPACE;
const ROOT = process.env.CF_E2E_ROOT;
const EXT_ID = "local-contextforge.contextforge-vscode";

let api;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000, what = "condition") => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
};

/** Temporarily replace vscode.window.* functions (the extension calls them at use time). */
function stub(obj, name, impl) {
  const orig = obj[name];
  obj[name] = impl;
  return () => (obj[name] = orig);
}

/** Act as an AI agent: write feedback through the bundled MCP server over stdio. */
function agentRecordsFeedback(serverPath, dbPath, message) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { env: { ...process.env, CONTEXTFORGE_DB: dbPath } });
    let buf = "";
    const timer = setTimeout(() => (child.kill(), reject(new Error("agent timeout"))), 15000);
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    child.stdout.on("data", (d) => {
      buf += String(d);
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_record_feedback", arguments: { projectPath: WS, feedbackType: "reject", message } } });
        } else if (j.id === 2) {
          clearTimeout(timer); child.kill(); j.error || j.result?.isError ? reject(new Error(JSON.stringify(j))) : resolve();
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-agent", version: "1" } } });
  });
}

describe("ContextForge in a real VS Code", function () {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, "extension is installed in the test host");
    api = await ext.activate();
    assert.ok(api, "activate() returned the API (workspace is trusted)");
  });

  it("registers all commands", async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of [
      "contextforge.openDashboard", "contextforge.teach", "contextforge.connectAgents",
      "contextforge.exportInstructions", "contextforge.openConflictDiff",
      "contextforge.approveLesson", "contextforge.rejectLesson",
    ]) assert.ok(cmds.includes(c), "missing command " + c);
  });

  it("opens the Review Inbox webview", async () => {
    await vscode.commands.executeCommand("contextforge.openDashboard");
    const tab = await waitFor(
      () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === "ContextForge"),
      10000, "inbox tab"
    );
    assert.ok(tab);
  });

  it("Teach creates a proposed lesson scoped to the current file", async () => {
    const doc = await vscode.workspace.openTextDocument(path.join(WS, "app", "model.ts"));
    await vscode.window.showTextDocument(doc);
    const restores = [
      stub(vscode.window, "showInputBox", async () => "Never use any; use unknown."),
      stub(vscode.window, "showQuickPick", async (items) => items.find((i) => i.label === "This folder")),
      stub(vscode.window, "showInformationMessage", async () => undefined),
    ];
    try {
      await vscode.commands.executeCommand("contextforge.teach");
    } finally { restores.forEach((r) => r()); }
    const s = api.getState();
    const lesson = s.proposed.find((r) => r.content === "Never use any; use unknown.");
    assert.ok(lesson, "lesson is in the Inbox");
    assert.strictEqual(lesson.appliesTo, "app/**");
  });

  it("live refresh: an agent's MCP write reaches the extension without reload", async () => {
    const before = api.getState().faults.length;
    let fired = false;
    const sub = api.onDidChange(() => (fired = true));
    const server = path.join(vscode.extensions.getExtension(EXT_ID).extensionPath, "dist", "mcp-server.cjs");
    await agentRecordsFeedback(server, path.join(ROOT, "memory.db"), "agent says: wrong table");
    await waitFor(() => fired, 8000, "onDidChange after agent write");
    sub.dispose();
    const s = api.getState();
    assert.ok(s.faults.length > before);
    assert.ok(s.faults.some((f) => f.message === "agent says: wrong table"));
  });

  it("inline approve acts on the clicked tree item (not a pick-list)", async () => {
    const lesson = api.getState().proposed[0];
    assert.ok(lesson, "have a proposed lesson");
    const restore = stub(vscode.window, "showQuickPick", async () => { throw new Error("must not prompt"); });
    try {
      await vscode.commands.executeCommand("contextforge.approveLesson", { kind: "rule", item: lesson });
    } finally { restore(); }
    assert.ok(api.getState().approved.some((r) => r.id === lesson.id));
  });

  it("Export shows native diffs, then writes only after confirmation", async () => {
    const agents = path.join(WS, "AGENTS.md");
    assert.ok(!fs.existsSync(agents));
    // 1) cancel -> nothing written
    let restore = stub(vscode.window, "showQuickPick", async () => undefined);
    try { await vscode.commands.executeCommand("contextforge.exportInstructions"); } finally { restore(); }
    assert.ok(!fs.existsSync(agents), "cancel writes nothing");
    // 2) confirm -> written
    restore = stub(vscode.window, "showQuickPick", async (items) => items);
    try { await vscode.commands.executeCommand("contextforge.exportInstructions"); } finally { restore(); }
    const text = fs.readFileSync(agents, "utf8");
    assert.match(text, /memory_get_context/);
    assert.match(text, /Never use any; use unknown\./);
  });

  it("Connect agents writes MCP config and the server really starts", async () => {
    const restores = [
      stub(vscode.window, "showQuickPick", async (items) => items.filter((i) => i.target === "claude-code")),
      stub(vscode.window, "showInformationMessage", async (msg, ...rest) => rest.find((r) => r === "Write files")),
      stub(vscode.window, "showErrorMessage", async (m) => { throw new Error("unexpected error: " + m); }),
    ];
    try {
      await vscode.commands.executeCommand("contextforge.connectAgents");
    } finally { restores.forEach((r) => r()); }
    const cfg = JSON.parse(fs.readFileSync(path.join(WS, ".mcp.json"), "utf8"));
    const entry = cfg.mcpServers.contextforge;
    assert.ok(entry, "contextforge server configured");
    assert.ok(fs.existsSync(entry.args[0]), "server file exists");
    assert.strictEqual(entry.env.CONTEXTFORGE_DB, path.join(ROOT, "memory.db"));
  });
});
