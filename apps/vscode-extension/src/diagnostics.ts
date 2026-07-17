import * as vscode from "vscode";
import { Backend } from "./backend.js";
import { detectConflicts } from "@contextforge/core";

export class MemoryDiagnostics {
  private collection: vscode.DiagnosticCollection;

  constructor(private backend: Backend) {
    this.collection = vscode.languages.createDiagnosticCollection("contextforge");
  }

  refresh(): void {
    if (!vscode.workspace.isTrusted) {
      this.collection.clear();
      return;
    }
    const proj = this.backend.getCurrentProject();
    this.collection.clear();
    if (!proj) return;

    const conflicts = detectConflicts(this.backend.repos, proj.projectId);
    if (conflicts.length === 0) return;

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const c of conflicts) {
      const left = this.backend.repos.getKnowledge(c.leftItemId);
      const right = this.backend.repos.getKnowledge(c.rightItemId);
      const files = new Set<string>();
      for (const item of [left, right]) {
        if (!item?.appliesTo) continue;
        for (const p of item.appliesTo.split(",")) {
          const cleaned = p.trim().replace("/**", "").replace(/\/$/, "");
          if (cleaned) files.add(cleaned);
        }
      }
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        `Rule conflict: ${c.explanation ?? c.conflictType}`,
        vscode.DiagnosticSeverity.Warning
      );
      diag.source = "ContextForge";
      if (files.size === 0) {
        const arr = byFile.get("<global>") ?? [];
        arr.push(diag);
        byFile.set("<global>", arr);
      } else {
        for (const f of files) {
          const arr = byFile.get(f) ?? [];
          arr.push(diag);
          byFile.set(f, arr);
        }
      }
    }

    for (const [file, diags] of byFile) {
      if (file === "<global>") continue;
      const uri = vscode.Uri.file(file);
      this.collection.set(uri, diags);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
