import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { normalizePath } from "@contextforge/shared";

export interface DetectedProject {
  rootPath: string;
  name: string;
  gitRemote: string | null;
  fingerprint: string | null;
}

function tryGitRemote(rootPath: string): string | null {
  try {
    const out = execSync("git config --get remote.origin.url", {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function computeFingerprint(rootPath: string): string | null {
  try {
    const files = execSync(
      "git ls-files | head -200 | sort | md5sum",
      { cwd: rootPath, stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    if (files) return files.split(/\s+/)[0] ?? null;
  } catch {
    // ignore
  }
  return createHash("md5").update(normalizePath(rootPath)).digest("hex");
}

export function detectProject(startPath: string): DetectedProject {
  let rootPath = normalizePath(startPath);
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: startPath,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (gitRoot) rootPath = normalizePath(gitRoot);
  } catch {
    // not a git repo; use provided path
  }
  const name = rootPath.split("/").filter(Boolean).pop() ?? "unnamed";
  return {
    rootPath,
    name,
    gitRemote: tryGitRemote(rootPath),
    fingerprint: computeFingerprint(rootPath),
  };
}
