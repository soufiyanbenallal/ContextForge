import * as vscode from "vscode";

/**
 * Read-only in-memory documents so we can use VS Code's native diff editor for
 * proposed export files and for comparing conflicting rules.
 */
const SCHEME = "contextforge";
const store = new Map<string, string>();
let counter = 0;

export function registerVirtualDocs(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: (uri) => store.get(uri.toString()) ?? "",
    })
  );
}

export function virtualUri(name: string, content: string): vscode.Uri {
  const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${name}`, query: String(++counter) });
  store.set(uri.toString(), content);
  return uri;
}

export async function showDiff(
  left: vscode.Uri,
  right: vscode.Uri,
  title: string
): Promise<void> {
  await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true });
}
