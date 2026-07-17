import * as vscode from "vscode";
import { Backend } from "./backend.js";
import { KnowledgeItem, ConflictRecord, CapabilityRecord } from "@contextforge/shared";

export type TreeNode =
  | { kind: "group"; label: string; children: TreeNode[] }
  | { kind: "rule"; item: KnowledgeItem }
  | { kind: "conflict"; item: ConflictRecord }
  | { kind: "capability"; item: CapabilityRecord }
  | { kind: "capIssue"; capabilityId: string; name: string; missing: string[] };

export class MemoryTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private backend: Backend) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "group": {
        const item = new vscode.TreeItem(
          node.label,
          node.children.length
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
        );
        return item;
      }
      case "rule": {
        const i = node.item;
        const item = new vscode.TreeItem(
          i.title,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${i.scope} · ${i.category} · p${i.priority}`;
        item.tooltip = i.content;
        item.contextValue = `rule:${i.status}`;
        item.iconPath = new vscode.ThemeIcon(
          i.status === "approved" ? "check" : i.status === "proposed" ? "question" : "circle-slash"
        );
        return item;
      }
      case "conflict": {
        const c = node.item;
        const item = new vscode.TreeItem(
          `Conflict: ${c.explanation ?? c.conflictType}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.contextValue = "conflict";
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "capability": {
        const c = node.item;
        const item = new vscode.TreeItem(
          `${c.type}: ${c.name}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = c.successRate !== null ? `${(c.successRate * 100).toFixed(0)}%` : "";
        item.contextValue = "capability";
        item.iconPath = new vscode.ThemeIcon(c.enabled ? "plug" : "unplug");
        return item;
      }
      case "capIssue": {
        const item = new vscode.TreeItem(
          `Missing config: ${node.name} (${node.missing.join(", ")})`,
          vscode.TreeItemCollapsibleState.None
        );
        item.contextValue = "capIssue";
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (node) {
      return node.kind === "group" ? node.children : [];
    }
    const proj = this.backend.getCurrentProject();
    if (!proj) return [{ kind: "group", label: "No workspace open", children: [] }];

    const approved = this.backend.repos.listKnowledge({
      projectId: proj.projectId,
      status: "approved",
    });
    const proposed = this.backend.repos.listKnowledge({
      projectId: proj.projectId,
      status: "proposed",
    });
    const conflicts = this.backend.repos.listConflicts(proj.projectId, "open");
    const caps = this.backend.repos.listCapabilities();

    const groups: TreeNode[] = [];
    groups.push({
      kind: "group",
      label: `Approved rules (${approved.length})`,
      children: approved.map((i) => ({ kind: "rule", item: i })),
    });
    groups.push({
      kind: "group",
      label: `Proposed lessons (${proposed.length})`,
      children: proposed.map((i) => ({ kind: "rule", item: i })),
    });
    groups.push({
      kind: "group",
      label: `Conflicts (${conflicts.length})`,
      children: conflicts.map((c) => ({ kind: "conflict", item: c })),
    });
    groups.push({
      kind: "group",
      label: `Skills & MCPs (${caps.length})`,
      children: caps.map((c) => ({ kind: "capability", item: c })),
    });

    const issues: TreeNode[] = [];
    for (const c of caps) {
      const v = this.backend.repos.validateCapabilityConfig(c.id);
      if (!v.valid) {
        issues.push({
          kind: "capIssue",
          capabilityId: c.id,
          name: c.name,
          missing: v.missing,
        });
      }
    }
    if (issues.length) {
      groups.push({
        kind: "group",
        label: `Capability config issues (${issues.length})`,
        children: issues,
      });
    }
    return groups;
  }
}
