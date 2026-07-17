import * as vscode from "vscode";
import { Backend } from "./backend.js";
import { KnowledgeItem, ConflictRecord, CapabilityRecord } from "@contextforge/shared";
import { getContext } from "@contextforge/core";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ruleRow(b: Backend, i: KnowledgeItem): string {
  const actions =
    i.status === "proposed"
      ? `<button data-act="approve" data-id="${i.id}">Approve</button>
         <button data-act="reject" data-id="${i.id}">Reject</button>`
      : i.status === "approved"
        ? `<button data-act="supersede" data-id="${i.id}">Supersede</button>`
        : `<span class="muted">rejected${i.rejectedReason ? ": " + esc(i.rejectedReason) : ""}</span>`;
  return `<tr>
    <td>${esc(i.title)}</td>
    <td class="muted">${esc(i.scope)} · ${esc(i.category)} · p${i.priority}</td>
    <td>${esc(i.content)}</td>
    <td class="actions">${actions}</td>
  </tr>`;
}

function conflictRow(c: ConflictRecord): string {
  return `<tr>
    <td>${esc(c.conflictType)}</td>
    <td>${esc(c.explanation ?? "")}</td>
    <td class="actions"><button data-act="resolve" data-id="${c.id}">Resolve</button></td>
  </tr>`;
}

function capRow(c: CapabilityRecord): string {
  const toggle = c.enabled
    ? `<button data-act="disable" data-id="${c.id}">Disable</button>`
    : `<button data-act="enable" data-id="${c.id}">Enable</button>`;
  const rate = c.successRate !== null ? `${(c.successRate * 100).toFixed(0)}%` : "—";
  return `<tr>
    <td>${esc(c.type)}: ${esc(c.name)}</td>
    <td class="muted">${rate}</td>
    <td class="actions">${toggle}</td>
  </tr>`;
}

export function renderDashboard(b: Backend): string {
  const dbPath =
    vscode.workspace.getConfiguration("contextforge").get<string | null>("dbPath") ||
    "~/.contextforge/memory.db";
  const proj = b.getCurrentProject();
  if (!proj) {
    return `<!DOCTYPE html><html><body><div class="empty">Open a workspace folder to use ContextForge.</div></body></html>`;
  }
  const approved = b.repos.listKnowledge({ projectId: proj.projectId, status: "approved" });
  const proposed = b.repos.listKnowledge({ projectId: proj.projectId, status: "proposed" });
  const conflicts = b.repos.listConflicts(proj.projectId, "open");
  const caps = b.repos.listCapabilities();
  const faults = b.repos.listFeedback(proj.projectId, 25);
  const ctx = getContext(b.repos, { projectId: proj.projectId });

  const issues: string[] = [];
  for (const c of caps) {
    const v = b.repos.validateCapabilityConfig(c.id);
    if (!v.valid) issues.push(`${esc(c.name)}: missing ${v.missing.join(", ")}`);
  }

  return `<!DOCTYPE html><html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family, system-ui); padding: 12px 16px; line-height: 1.5; }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  h2 { font-size: 1em; margin: 18px 0 6px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 8px; font-size: .9em; }
  table { width: 100%; border-collapse: collapse; font-size: .9em; }
  td, th { text-align: left; padding: 4px 8px; vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border); }
  .muted { color: var(--vscode-descriptionForeground); }
  .actions button { margin-right: 4px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 3px; padding: 3px 10px; cursor: pointer; font-size: .85em; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .toolbar { margin: 8px 0; }
  .toolbar button { margin-right: 6px; }
  .warn { color: var(--vscode-errorForeground); }
  .empty { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <h1>Project Memory — ${esc(proj.rootPath)}</h1>
  <p class="sub">DB: ${esc(dbPath)}</p>

  <div class="toolbar">
    <button data-act="record">Record feedback</button>
    <button data-act="export">Export instructions</button>
    <button data-act="conflicts">Check conflicts</button>
    <button data-act="refresh">Refresh</button>
  </div>

  ${ctx.warnings.length ? `<p class="warn">⚠ ${ctx.warnings.map(esc).join("; ")}</p>` : ""}
  ${issues.length ? `<p class="warn">⚠ Capability issues: ${issues.join("; ")}</p>` : ""}

  <h2>Proposed lessons (${proposed.length})</h2>
  ${proposed.length ? `<table><tr><th>Title</th><th>Meta</th><th>Content</th><th></th></tr>${proposed.map((i) => ruleRow(b, i)).join("")}</table>` : `<p class="muted">None. Use “Record feedback” then approve.</p>`}

  <h2>Approved rules (${approved.length})</h2>
  ${approved.length ? `<table><tr><th>Title</th><th>Meta</th><th>Content</th><th></th></tr>${approved.map((i) => ruleRow(b, i)).join("")}</table>` : `<p class="muted">None approved yet.</p>`}

  <h2>Conflicts (${conflicts.length})</h2>
  ${conflicts.length ? `<table><tr><th>Type</th><th>Detail</th><th></th></tr>${conflicts.map(conflictRow).join("")}</table>` : `<p class="muted">No open conflicts.</p>`}

  <h2>Skills &amp; MCPs (${caps.length})</h2>
  ${caps.length ? `<table><tr><th>Capability</th><th>Success</th><th></th></tr>${caps.map(capRow).join("")}</table>` : `<p class="muted">None discovered.</p>`}

  <h2>Captured faults &amp; feedback (${faults.length})</h2>
  ${
    faults.length
      ? `<table><tr><th>Type</th><th>Message</th><th></th></tr>${faults
          .map(
            (f) => `<tr>
        <td class="muted">${esc(f.feedbackType)} · ${esc(f.severity)}</td>
        <td>${esc(f.message.slice(0, 200))}</td>
        <td class="actions"><button data-act="extract" data-id="${f.id}">Extract lesson</button></td>
      </tr>`
          )
          .join("")}</table>`
      : `<p class="muted">No faults captured yet. Failures in build/test/terminal are captured automatically.</p>`
  }
</body>
</html>`;
}

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly backend: Backend;
  private readonly onChanged: () => void;

  private constructor(panel: vscode.WebviewPanel, backend: Backend, onChanged: () => void) {
    this.panel = panel;
    this.backend = backend;
    this.onChanged = onChanged;
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.render();
    this.panel.onDidDispose(() => {
      if (DashboardPanel.current === this) DashboardPanel.current = undefined;
    });
  }

  static open(backend: Backend, onChanged: () => void) {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "contextforgeDashboard",
      "ContextForge Dashboard",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    DashboardPanel.current = new DashboardPanel(panel, backend, onChanged);
  }

  private render() {
    this.panel.webview.html = renderDashboard(this.backend);
  }

  private async handle(msg: { act: string; id?: string }) {
    const b = this.backend;
    switch (msg.act) {
      case "refresh":
        break;
      case "approve":
        if (msg.id) b.repos.updateKnowledgeStatus(msg.id, "approved");
        break;
      case "reject":
        if (msg.id) {
          const reason = await vscode.window.showInputBox({ prompt: "Reason for rejection" });
          b.repos.updateKnowledgeStatus(msg.id, "rejected", { reason: reason ?? null });
        }
        break;
      case "supersede":
        if (msg.id) {
          const content = await vscode.window.showInputBox({ prompt: "Replacement content" });
          if (content) {
            const old = b.repos.getKnowledge(msg.id);
            if (old) {
              const nw = b.repos.createKnowledge({
                projectId: old.projectId,
                scope: old.scope,
                category: old.category,
                title: old.title,
                content,
                status: "approved",
                appliesTo: old.appliesTo ?? undefined,
                sourceType: "manual",
              });
              b.repos.supersedeKnowledge(msg.id, nw.id);
            }
          }
        }
        break;
      case "resolve":
        if (msg.id) b.repos.resolveConflict(msg.id, "Manually resolved from dashboard");
        break;
      case "extract":
        if (msg.id) {
          const { autoLearn } = await import("@contextforge/core");
          const res = autoLearn(b.repos, msg.id, { scopeLabel: "project" });
          if ("alreadyExists" in res) {
            vscode.window.showInformationMessage("A lesson was already extracted from this fault.");
          } else {
            vscode.window.showInformationMessage("Lesson proposed. Review in Proposed lessons.");
          }
        }
        break;
      case "enable":
        if (msg.id) b.repos.setCapabilityEnabled(msg.id, true);
        break;
      case "disable":
        if (msg.id) b.repos.setCapabilityEnabled(msg.id, false);
        break;
      case "record":
        await vscode.commands.executeCommand("contextforge.rejectResult");
        break;
      case "export":
        await vscode.commands.executeCommand("contextforge.exportInstructions");
        break;
      case "conflicts":
        await vscode.commands.executeCommand("contextforge.checkConflicts");
        break;
    }
    this.onChanged();
    this.render();
  }
}
