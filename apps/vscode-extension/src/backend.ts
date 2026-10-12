import * as vscode from "vscode";
import { openDatabase, Repositories } from "@contextforge/database";
import { detectProject } from "@contextforge/core";
import { existsSync, mkdirSync, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Backend {
  repos: Repositories;
  /** Fires when memory changed (our own write or another process, e.g. an agent via MCP). */
  onDidChange: vscode.Event<void>;
  dbPath: string;
  dispose(): void;
  refresh(): void;
  getCurrentProject(): { projectId: string; rootPath: string } | null;
}

export function resolveDbPath(): string {
  const cfg = vscode.workspace
    .getConfiguration("contextforge")
    .get<string | null>("dbPath");
  if (cfg) return cfg;
  return join(homedir(), ".contextforge", "memory.db");
}

export async function createBackend(): Promise<Backend> {
  const path = resolveDbPath();
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = await openDatabase(path);
  const repos = new Repositories(db);

  const event = new vscode.EventEmitter<void>();
  // Poll the DB file so writes from other processes (MCP server, CLI) show up
  // live. Debounced; harmless when we caused the change ourselves.
  let timer: NodeJS.Timeout | undefined;
  watchFile(path, { interval: 700 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => event.fire(), 150);
  });
  return {
    repos,
    dbPath: path,
    onDidChange: event.event,
    dispose: () => {
      clearTimeout(timer);
      unwatchFile(path);
      event.dispose();
    },
    refresh: () => event.fire(),
    getCurrentProject: () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) return null;
      const detected = detectProject(folders[0]!.uri.fsPath);
      const project = repos.upsertProject({
        name: detected.name,
        rootPath: detected.rootPath,
        gitRemote: detected.gitRemote,
        fingerprint: detected.fingerprint,
      });
      return { projectId: project.id, rootPath: detected.rootPath };
    },
  };
}
