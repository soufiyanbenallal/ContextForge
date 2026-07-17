export const workspace = {
  isTrusted: true,
  workspaceFolders: [{ uri: { fsPath: "/tmp/am-ext-ws" } }],
  getConfiguration: () => ({ get: () => null }),
  onDidChangeWorkspaceFolders: () => ({}),
  onDidGrantWorkspaceTrust: () => ({}),
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve("rule content"),
  showQuickPick: (items: any) =>
    Promise.resolve(Array.isArray(items) ? items[0] : undefined),
  createOutputChannel: () => ({ clear() {}, appendLine() {}, show() {} }),
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => ({}),
  registerTreeDataProvider: () => ({}),
};

export const commands = {
  registerCommand: (_id: string, _fn: Function) => ({}),
  executeCommand: () => Promise.resolve(undefined),
};

export class EventEmitter<T> {
  fire(_t?: T) {}
  event = () => ({});
}

export class TreeItem {
  label: any;
  collapsibleState?: any;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: any;
  constructor(label: any, collapsibleState?: any) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export class ThemeIcon {
  constructor(public id: string) {}
}
export class Range {
  constructor(..._a: any[]) {}
}
export class Diagnostic {
  source = "";
  constructor(public range: any, public message: string, public severity?: any) {}
}
export const DiagnosticSeverity = { Warning: 1, Error: 0, Information: 2, Hint: 3 };
export class DiagnosticCollection {
  set = () => {};
  clear = () => {};
  dispose = () => {};
}
export const languages = {
  createDiagnosticCollection: () => new DiagnosticCollection(),
};
export const Uri = { file: (p: string) => ({ fsPath: p }) };
