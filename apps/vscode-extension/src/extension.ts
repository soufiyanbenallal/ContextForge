import * as vscode from "vscode";
import { createBackend, Backend } from "./backend.js";
import { MemoryTreeProvider } from "./tree.js";
import { registerCommands } from "./commands.js";
import { MemoryDiagnostics } from "./diagnostics.js";
import { watchTaskFaults } from "./capture.js";
import { ReviewStatusBar } from "./statusbar.js";
import { RulesCodeLens } from "./codelens.js";
import { registerVirtualDocs } from "./virtual-docs.js";
import { buildState } from "./service.js";

let backend: Backend | null = null;
let diagnostics: MemoryDiagnostics | null = null;

/** Small surface used by the end-to-end tests (and other extensions). */
export interface ContextForgeApi {
  getState(): ReturnType<typeof buildState> | null;
  onDidChange: vscode.Event<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<ContextForgeApi | undefined> {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage(
      "ContextForge: workspace is not trusted. Memory features are disabled until you trust this workspace."
    );
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      })
    );
    return undefined;
  }
  return bootstrap(context);
}

async function bootstrap(context: vscode.ExtensionContext): Promise<ContextForgeApi> {
  backend = await createBackend();
  const treeProvider = new MemoryTreeProvider(backend);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("contextforgeView", treeProvider)
  );

  registerCommands(context, backend, treeProvider);

  diagnostics = new MemoryDiagnostics(backend);
  context.subscriptions.push(diagnostics);
  diagnostics.refresh();

  registerVirtualDocs(context);
  context.subscriptions.push(new ReviewStatusBar(backend));
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, new RulesCodeLens(backend))
  );

  const refreshAll = () => {
    treeProvider.refresh();
    diagnostics?.refresh();
  };
  // Live refresh: our own writes and writes by agents (MCP) / CLI.
  context.subscriptions.push(backend.onDidChange(refreshAll));
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

  const be = backend;
  return {
    getState: () => {
      const proj = be.getCurrentProject();
      return proj ? buildState(be.repos, proj) : null;
    },
    onDidChange: be.onDidChange,
  };
}

export function deactivate(): void {
  diagnostics?.dispose();
  backend?.dispose();
  backend = null;
}
