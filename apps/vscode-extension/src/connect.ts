import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** VS Code-free logic for the "Connect agents" wizard. */

export type AgentTarget = "vscode" | "claude-code" | "cursor";

interface TargetSpec {
  label: string;
  file: string;
  /** Top-level key holding the server map. */
  key: "servers" | "mcpServers";
}

export const TARGETS: Record<AgentTarget, TargetSpec> = {
  vscode: { label: "VS Code (Copilot Chat)", file: ".vscode/mcp.json", key: "servers" },
  "claude-code": { label: "Claude Code", file: ".mcp.json", key: "mcpServers" },
  cursor: { label: "Cursor", file: ".cursor/mcp.json", key: "mcpServers" },
};

export interface PlannedConfig {
  target: AgentTarget;
  path: string;
  existing: string;
  content: string;
  changed: boolean;
}

export function planConnect(
  rootPath: string,
  targets: AgentTarget[],
  serverPath: string,
  dbPath: string
): PlannedConfig[] {
  return targets.map((target) => {
    const spec = TARGETS[target];
    const path = join(rootPath, spec.file);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    let json: Record<string, any> = {};
    if (existing.trim()) {
      try {
        json = JSON.parse(existing);
      } catch {
        throw new Error(
          `${spec.file} is not valid JSON (comments are not supported); fix it and retry.`
        );
      }
    }
    const servers = { ...(json[spec.key] ?? {}) };
    servers["contextforge"] = {
      ...(target === "vscode" ? { type: "stdio" } : {}),
      command: "node",
      args: [serverPath],
      env: { CONTEXTFORGE_DB: dbPath },
    };
    json[spec.key] = servers;
    const content = JSON.stringify(json, null, 2) + "\n";
    return { target, path, existing, content, changed: content !== existing };
  });
}

/** Spawn the server and complete an MCP `initialize` handshake. */
export function verifyServer(
  serverPath: string,
  dbPath: string,
  timeoutMs = 8000
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, CONTEXTFORGE_DB: dbPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let done = false;
    const finish = (ok: boolean, detail: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => finish(false, `no response in ${timeoutMs}ms. ${err}`.trim()), timeoutMs);
    child.stdout.on("data", (d) => {
      out += String(d);
      const line = out.split("\n").find((l) => l.includes('"result"'));
      if (line) {
        try {
          const name = JSON.parse(line).result?.serverInfo?.name;
          finish(true, `connected to ${name ?? "server"}`);
        } catch {
          finish(false, "invalid response");
        }
      }
    });
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => finish(false, e.message));
    child.on("exit", (code) => finish(false, `server exited (${code}). ${err}`.trim()));
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "contextforge-verify", version: "1" },
        },
      }) + "\n"
    );
  });
}
