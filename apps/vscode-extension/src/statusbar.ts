import * as vscode from "vscode";
import { Backend } from "./backend.js";

/** `ContextForge ● 4 to review` – opens the Inbox. Updates live. */
export class ReviewStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly sub: vscode.Disposable;

  constructor(private readonly backend: Backend) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "contextforge.openDashboard";
    this.sub = backend.onDidChange(() => this.update());
    this.update();
    this.item.show();
  }

  update(): void {
    const proj = this.backend.getCurrentProject();
    if (!proj) {
      this.item.hide();
      return;
    }
    const proposed = this.backend.repos.listKnowledge({
      projectId: proj.projectId,
      status: "proposed",
    }).length;
    const conflicts = this.backend.repos.listConflicts(proj.projectId, "open").length;
    const parts: string[] = [];
    if (proposed) parts.push(`${proposed} to review`);
    if (conflicts) parts.push(`${conflicts} conflict${conflicts === 1 ? "" : "s"}`);
    this.item.text = `$(brain) ContextForge${parts.length ? " ● " + parts.join(" · ") : ""}`;
    this.item.tooltip = parts.length
      ? "Open the ContextForge review inbox"
      : "ContextForge — nothing to review";
    this.item.backgroundColor = conflicts
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    this.item.show();
  }

  dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
