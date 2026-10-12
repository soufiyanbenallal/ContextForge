import { Repositories, openDatabase } from "@contextforge/database";
import { detectProject } from "@contextforge/core";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultDbPath(): string {
  return join(homedir(), ".contextforge", "memory.db");
}

export interface ServerContext {
  repos: Repositories;
}

export async function createServerContext(dbPath?: string): Promise<ServerContext> {
  const path = dbPath ?? defaultDbPath();
  const dir = dirname(path);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = await openDatabase(path);
  return { repos: new Repositories(db) };
}

export function resolveProject(
  ctx: ServerContext,
  projectPath?: string
): { projectId: string; rootPath: string } {
  const detected = detectProject(projectPath ?? process.cwd());
  const project = ctx.repos.upsertProject({
    name: detected.name,
    rootPath: detected.rootPath,
    gitRemote: detected.gitRemote,
    fingerprint: detected.fingerprint,
  });
  return { projectId: project.id, rootPath: detected.rootPath };
}
