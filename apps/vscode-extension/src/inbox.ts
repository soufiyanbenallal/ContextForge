import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { Backend } from "./backend.js";
import { inboxHtml } from "./inbox-html.js";
import { buildState, applyAction, InboxAction } from "./service.js";

type FromWebview =
  | { type: "ready" }
  | { type: "action"; action: InboxAction }
  | { type: "command"; command: string }
  | { type: "openDiff"; id: string };

const COMMANDS: Record<string, string> = {
  teach: "contextforge.teach",
  checkConflicts: "contextforge.checkConflicts",
  export: "contextforge.exportInstructions",
  connect: "contextforge.connectAgents",
};

/** The Review Inbox: one editor tab with state pushed over messages (no full re-render). */
export class InboxPanel {
  static current: InboxPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly backend: Backend
  ) {
    panel.webview.html = inboxHtml(randomBytes(16).toString("base64"), panel.webview.cspSource);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: FromWebview) => this.handle(m)),
      backend.onDidChange(() => this.postState()),
      panel.onDidDispose(() => {
        this.disposables.forEach((d) => d.dispose());
        if (InboxPanel.current === this) InboxPanel.current = undefined;
      })
    );
  }

  static open(backend: Backend): void {
    if (InboxPanel.current) {
      InboxPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "contextforgeInbox",
      "ContextForge",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    InboxPanel.current = new InboxPanel(panel, backend);
  }

  private postState(): void {
    const project = this.backend.getCurrentProject();
    if (!project) {
      void this.panel.webview.postMessage({ type: "error", message: "Open a workspace folder first." });
      return;
    }
    void this.panel.webview.postMessage({
      type: "state",
      state: buildState(this.backend.repos, project),
    });
  }

  private async handle(m: FromWebview): Promise<void> {
    try {
      switch (m.type) {
        case "ready":
          this.postState();
          return;
        case "action": {
          const result = applyAction(this.backend.repos, m.action);
          this.backend.refresh();
          if (result.message) {
            void this.panel.webview.postMessage({
              type: "toast",
              message: result.message,
              undo: result.undo,
            });
          }
          return;
        }
        case "command": {
          const id = COMMANDS[m.command];
          if (id) await vscode.commands.executeCommand(id);
          return;
        }
        case "openDiff":
          await vscode.commands.executeCommand("contextforge.openConflictDiff", m.id);
          return;
      }
    } catch (err) {
      void this.panel.webview.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
