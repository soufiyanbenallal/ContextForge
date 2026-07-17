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
  const proj = backend.getCurrentProject();
  if (!proj) return;
  const now = Date.now();
  if (now - lastCapturedAt < 1500) return;
  lastCapturedAt = now;

  try {
    const result = captureFault(backend.repos, {
      projectId: proj.projectId,
      kind,
      message,
      detail: opts.detail,
      source: opts.source ?? null,
      appliesTo: opts.appliesTo ?? null,
    });
    const rel = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    rel.hide();
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
    void result;
  } catch (err) {
    console.error("[ContextForge] fault capture failed:", err);
  }
}

const BUILD_FAILURE = /(?:error|failed|non-zero exit code|exited with code)\b/i;
const TEST_FAILURE = /(?:\d+ (?:failing|failed)|test.*failed|✗|FAIL\b)/i;
const LINT_ERROR = /(?:\b(error|warning)\b.*(?:eslint|tslint|biome|ruff|lint))/i;
const TYPE_ERROR = /(?:TS\d{3,}|type error|TypeError|could not infer type)/i;

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

/**
 * Watches terminal output for error signatures and captures them as faults.
 */
export function watchTerminalFaults(backend: Backend): vscode.Disposable {
  const sub = vscode.window.onDidWriteTerminalData?.((e) => {
    const data: string = (e as { data: string }).data;
    if (!BUILD_FAILURE.test(data) && !TEST_FAILURE.test(data) && !LINT_ERROR.test(data) && !TYPE_ERROR.test(data))
      return;
    let kind: FaultKind = "runtime";
    if (TYPE_ERROR.test(data)) kind = "typecheck";
    else if (LINT_ERROR.test(data)) kind = "lint";
    else if (TEST_FAILURE.test(data)) kind = "test";
    else if (BUILD_FAILURE.test(data)) kind = "build";
    const line = data.split("\n").find((l) => l.trim().length > 0) ?? data;
    captureFaultToMemory(backend, kind, line.slice(0, 300), {
      source: "vscode-terminal",
    });
  });
  return sub ?? new vscode.Disposable(() => {});
}
