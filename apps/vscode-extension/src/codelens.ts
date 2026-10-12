import * as vscode from "vscode";
import { relative } from "node:path";
import { Backend } from "./backend.js";
import { matchesAppliesTo } from "./glob.js";

/** "3 rules apply to this file" at the top of matching files. */
export class RulesCodeLens implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly backend: Backend) {
    backend.onDidChange(() => this.emitter.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.isTrusted || doc.uri.scheme !== "file") return [];
    const proj = this.backend.getCurrentProject();
    if (!proj) return [];
    const rel = relative(proj.rootPath, doc.uri.fsPath);
    if (rel.startsWith("..")) return [];
    const n = this.backend.repos
      .listKnowledge({ projectId: proj.projectId, status: "approved" })
      .filter((i) => i.appliesTo && matchesAppliesTo(i.appliesTo, rel)).length;
    if (!n) return [];
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: `$(brain) ${n} ContextForge rule${n === 1 ? "" : "s"} apply to this file`,
        command: "contextforge.showRulesForFile",
      }),
    ];
  }
}
