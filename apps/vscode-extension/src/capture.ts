import * as vscode from "vscode";
import { Backend } from "./backend.js";
import { captureFault, FaultKind } from "@contextforge/core";

let lastCapturedAt = 0;

/**
 * Passively captures a fault into the memory DB and notifies the user with a
 * quick link to the Dashboard. De-bounced so a burst of identical errors in
 * the same second does not spam the DB.
 */
export function captureFaultToMemory(
  backend: Backend,
  kind: FaultKind,
  message: string,
  opts: { detail?: string; source?: string; appliesTo?: string } = {}
): void {
  if (!vscode.workspace.getConfiguration("contextforge").get<boolean>("captureFaults")) return;
  const proj = backend.getCurrentProject();
  if (!proj) return;
  const now = Date.now();
  if (now - lastCapturedAt < 1500) return;
  lastCapturedAt = now;

  try {
    captureFault(backend.repos, {
      projectId: proj.projectId,
      kind,
      message,
      detail: opts.detail,
      source: opts.source ?? null,
      appliesTo: opts.appliesTo ?? null,
    });
    vscode.window
      .showInformationMessage(
        `ContextForge: captured ${kind} fault as a lesson proposal.`,
        "Review"
      )
      .then((choice) => {
        if (choice === "Review") {
          vscode.commands.executeCommand("contextforge.openDashboard");
        }
      });
  } catch (err) {
    console.error("[ContextForge] fault capture failed:", err);
  }
}

/**
 * Watches task completions (build/test/run) and captures non-zero exits as
 * faults. Returns a disposer.
 */
export function watchTaskFaults(backend: Backend): vscode.Disposable {
  return vscode.tasks.onDidEndTaskProcess((e) => {
    const exit = e.exitCode;
    if (exit === undefined || exit === 0) return;
    const name = e.execution.task.name.toLowerCase();
    let kind: FaultKind = "build";
    if (name.includes("test")) kind = "test";
    else if (name.includes("lint")) kind = "lint";
    else if (name.includes("typecheck") || name.includes("tsc")) kind = "typecheck";
    else if (name.includes("run") || name.includes("start")) kind = "runtime";
    captureFaultToMemory(backend, kind, `Task failed: ${e.execution.task.name}`, {
      detail: `Exit code ${exit}`,
      source: "vscode-task",
    });
  });
}
