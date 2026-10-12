import * as vscode from "vscode";
import { createBackend, Backend } from "./backend.js";
import { MemoryTreeProvider } from "./tree.js";
import { registerCommands } from "./commands.js";
import { MemoryDiagnostics } from "./diagnostics.js";
import { watchTaskFaults } from "./capture.js";

let backend: Backend | null = null;
let diagnostics: MemoryDiagnostics | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      "ContextForge: workspace is not trusted. Memory features are disabled until you trust this workspace."
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      })
    );
    return;
  }
  await bootstrap(context);
}

async function bootstrap(context: vscode.ExtensionContext): Promise<void> {
  backend = await createBackend();
  const treeProvider = new MemoryTreeProvider(backend);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("contextforgeView", treeProvider)
  );

  registerCommands(context, backend, treeProvider);

  diagnostics = new MemoryDiagnostics(backend);
  context.subscriptions.push(diagnostics);
  diagnostics.refresh();

  const refreshAll = () => {
    treeProvider.refresh();
    diagnostics?.refresh();
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => diagnostics?.refresh())
  );

  // Opt-in (contextforge.captureFaults): failed build/test/lint tasks are
  // recorded as lesson proposals.
  context.subscriptions.push(watchTaskFaults(backend));

  // Refresh the tree once on activation.
  treeProvider.refresh();
}

export function deactivate(): void {
  diagnostics?.dispose();
  backend = null;
}
