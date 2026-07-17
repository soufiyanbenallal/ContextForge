import * as vscode from "vscode";
import { Backend } from "./backend.js";
import {
  FeedbackClassification,
  KnowledgeScope,
} from "@contextforge/shared";
import { DashboardPanel } from "./dashboard.js";
import { exportForProject } from "@contextforge/exporters";
import { getContext } from "@contextforge/core";

const CLASSIFICATIONS: { label: string; value: FeedbackClassification }[] = [
  { label: "Incorrect code", value: "incorrect-code" },
  { label: "Violated project architecture", value: "violated-architecture" },
  { label: "Ignored explicit request", value: "ignored-request" },
  { label: "Used outdated API", value: "outdated-api" },
  { label: "Unnecessary complexity", value: "unnecessary-complexity" },
  { label: "Wrong tool or skill", value: "wrong-tool" },
  { label: "Other", value: "other" },
];

const SCOPE_LABELS: { label: string; value: KnowledgeScope }[] = [
  { label: "This task only", value: "task" },
  { label: "This project", value: "project" },
  { label: "All projects (global)", value: "global" },
];

async function requireProject(backend: Backend) {
  const proj = backend.getCurrentProject();
  if (!proj) {
    vscode.window.showErrorMessage("ContextForge: open a workspace folder first.");
    return null;
  }
  return proj;
}

async function recordFeedback(
  backend: Backend,
  feedbackType: "accept" | "reject" | "correction",
  presetMessage?: string
) {
  const proj = await requireProject(backend);
  if (!proj) return;

  const message =
    presetMessage ??
    (await vscode.window.showInputBox({
      prompt: feedbackType === "accept" ? "What was correct?" : "Why was this wrong?",
      placeHolder: "Describe the feedback",
    }));
  if (!message) return;

  const severity = await vscode.window.showQuickPick(
    ["low", "normal", "high", "critical"],
    { title: "Severity" }
  );

  let classification: FeedbackClassification | undefined;
  if (feedbackType !== "accept") {
    const pick = await vscode.window.showQuickPick(
      CLASSIFICATIONS.map((c) => ({ label: c.label, value: c.value })),
      { title: "Classification" }
    );
    classification = pick?.value;
  }

  const fb = backend.repos.recordFeedback({
    projectId: proj.projectId,
    feedbackType,
    message,
    severity: (severity as never) ?? "normal",
    classification: classification ?? null,
  });
  vscode.window.showInformationMessage(`ContextForge: feedback recorded (${fb.id}).`);
  backend.refresh();
}

async function saveAsRule(backend: Backend, globalPref: boolean) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const editor = vscode.window.activeTextEditor;
  const text =
    editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : await vscode.window.showInputBox({ prompt: "Rule content" });
  if (!text) return;

  const scope: KnowledgeScope = globalPref ? "global" : "project";
  const item = backend.repos.createKnowledge({
    projectId: globalPref ? null : proj.projectId,
    scope,
    category: "coding-rule",
    title: text.length > 80 ? text.slice(0, 77) + "..." : text,
    content: text,
    status: "proposed",
    priority: 70,
    confidence: 0.6,
    sourceType: "manual",
  });
  vscode.window.showInformationMessage(
    `ContextForge: saved as proposed ${scope} rule (${item.id}). Review & approve it.`
  );
  backend.refresh();
}

async function viewRelevantMemory(backend: Backend) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const editor = vscode.window.activeTextEditor;
  const files = editor ? [editor.document.fileName] : undefined;
  const ctx = getContext(backend.repos, { projectId: proj.projectId, files });
  const panel = vscode.window.createOutputChannel("ContextForge");
  panel.clear();
  panel.appendLine("Relevant memory for current context:\n");
  panel.appendLine("Required rules:");
  for (const r of ctx.requiredRules) panel.appendLine(`  - ${r.content}`);
  panel.appendLine("Relevant decisions:");
  for (const d of ctx.relevantDecisions) panel.appendLine(`  - ${d.content}`);
  panel.appendLine("Failed approaches:");
  for (const f of ctx.failedApproaches) panel.appendLine(`  - ${f.content}`);
  if (ctx.warnings.length) {
    panel.appendLine("\nWarnings:");
    for (const w of ctx.warnings) panel.appendLine(`  ! ${w}`);
  }
  panel.show();
}

async function reviewProposedLessons(backend: Backend, forceAction?: "approve" | "reject") {
  const proj = await requireProject(backend);
  if (!proj) return;
  const proposed = backend.repos.listKnowledge({
    projectId: proj.projectId,
    status: "proposed",
  });
  if (proposed.length === 0) {
    vscode.window.showInformationMessage("ContextForge: no proposed lessons.");
    return;
  }
  const pick = await vscode.window.showQuickPick(
    proposed.map((i) => ({ label: i.title, detail: i.content, id: i.id })),
    { title: "Proposed lessons — pick one to resolve", canPickMany: false }
  );
  if (!pick) return;
  let action = forceAction;
  if (!action) {
    const a = await vscode.window.showQuickPick(["Approve", "Reject"], {
      title: "Action",
    });
    action = a === "Approve" ? "approve" : a === "Reject" ? "reject" : undefined;
  }
  if (action === "approve") {
    backend.repos.updateKnowledgeStatus(pick.id, "approved");
    vscode.window.showInformationMessage("ContextForge: lesson approved.");
  } else if (action === "reject") {
    const reason = await vscode.window.showInputBox({ prompt: "Reason for rejection" });
    backend.repos.updateKnowledgeStatus(pick.id, "rejected", { reason: reason ?? null });
    vscode.window.showInformationMessage("ContextForge: lesson rejected.");
  }
  backend.refresh();
}

async function checkConflicts(backend: Backend) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const { detectConflicts } = await import("@contextforge/core");
  const detected = detectConflicts(backend.repos, proj.projectId);
  const created = detected.map((d) =>
    backend.repos.createConflict({
      projectId: proj.projectId,
      leftItemId: d.leftItemId,
      rightItemId: d.rightItemId,
      conflictType: d.conflictType,
      explanation: d.explanation,
    })
  );
  vscode.window.showInformationMessage(
    `ContextForge: ${detected.length} conflict(s) detected${created.length ? " and recorded" : ""}.`
  );
  backend.refresh();
}

async function showRulesForFile(backend: Backend) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("ContextForge: open a file first.");
    return;
  }
  const proj = await requireProject(backend);
  if (!proj) return;
  const file = editor.document.fileName;
  const items = backend.repos.listKnowledge({
    projectId: proj.projectId,
    status: "approved",
  });
  const matching = items.filter((i) =>
    (i.appliesTo ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((p) => file.includes(p.replace("/**", "").replace(/\/$/, "")))
  );
  const panel = vscode.window.createOutputChannel("ContextForge");
  panel.clear();
  panel.appendLine(`Rules affecting ${editor.document.fileName}:\n`);
  if (matching.length === 0) panel.appendLine("  (none with an explicit file scope)");
  for (const m of matching) panel.appendLine(`  - [${m.category}] ${m.content}`);
  panel.show();
}

async function exportInstructions(backend: Backend) {
  const proj = await requireProject(backend);
  if (!proj) return;
  if (!vscode.workspace.isTrusted) {
    vscode.window.showErrorMessage("ContextForge: workspace is not trusted; refusing to write files.");
    return;
  }
  const { planExport, applyExport } = await import("@contextforge/exporters");
  const planned = planExport(backend.repos, proj.projectId, proj.rootPath);
  const changes = planned.filter((p) => p.diff);
  if (changes.length === 0) {
    vscode.window.showInformationMessage("ContextForge: instructions are up to date.");
    return;
  }
  const panel = vscode.window.createOutputChannel("ContextForge Export");
  panel.clear();
  panel.appendLine(`Export plan: ${planned.length} file(s), ${changes.length} with changes.\n`);
  for (const f of changes) {
    panel.appendLine(`--- ${f.path} ---`);
    panel.appendLine(f.diff ?? "");
    panel.appendLine("");
  }
  panel.show();
  const confirm = await vscode.window.showWarningMessage(
    `ContextForge will write ${changes.length} file(s). Continue?`,
    "Apply",
    "Cancel"
  );
  if (confirm !== "Apply") {
    vscode.window.showInformationMessage("ContextForge: export cancelled (no files written).");
    return;
  }
  const written = applyExport(planned);
  vscode.window.showInformationMessage(`ContextForge: wrote ${written.length} file(s).`);
}

async function learnFromError(backend: Backend) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const diags = vscode.languages.getDiagnostics();
  const errors: { msg: string; file: string }[] = [];
  for (const [uri, list] of diags) {
    for (const d of list) {
      if (d.severity === vscode.DiagnosticSeverity.Error) {
        errors.push({ msg: d.message, file: uri.fsPath });
      }
    }
  }
  if (errors.length === 0) {
    vscode.window.showInformationMessage("ContextForge: no active errors in the Problems panel.");
    return;
  }
  const { captureFault } = await import("@contextforge/core");
  let captured = 0;
  for (const e of errors.slice(0, 10)) {
    captureFault(backend.repos, {
      projectId: proj.projectId,
      kind: "typecheck",
      message: e.msg,
      detail: e.file,
      source: "problems-panel",
      appliesTo: e.file,
    });
    captured++;
  }
  vscode.window.showInformationMessage(
    `ContextForge: captured ${captured} error(s) as lesson proposals. Review in the Dashboard.`
  );
  backend.refresh();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  backend: Backend,
  treeProvider: { refresh(): void }
) {
  const wrap =
    (fn: (b: Backend) => Promise<void>) => async () => {
      if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage("ContextForge: workspace is not trusted.");
        return;
      }
      await fn(backend);
      treeProvider.refresh();
    };

  const register = (id: string, fn: (...args: any[]) => Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, fn)
    );

  register("contextforge.refresh", wrap(async () => {}));
  register("contextforge.acceptResult", wrap((b) => recordFeedback(b, "accept")));
  register("contextforge.rejectResult", wrap((b) => recordFeedback(b, "reject")));
  register(
    "contextforge.recordCorrection",
    wrap((b) => recordFeedback(b, "correction"))
  );
  register("contextforge.saveAsProjectRule", wrap((b) => saveAsRule(b, false)));
  register("contextforge.saveAsGlobalPreference", wrap((b) => saveAsRule(b, true)));
  register("contextforge.viewRelevantMemory", () => viewRelevantMemory(backend));
  register("contextforge.reviewProposedLessons", wrap((b) => reviewProposedLessons(b)));
  register("contextforge.checkConflicts", wrap((b) => checkConflicts(b)));
  register("contextforge.showRulesForFile", () => showRulesForFile(backend));
  register("contextforge.exportInstructions", wrap((b) => exportInstructions(b)));
  register("contextforge.approveLesson", wrap(async (b) => reviewProposedLessons(b, "approve")));
  register("contextforge.rejectLesson", wrap(async (b) => reviewProposedLessons(b, "reject")));
  register("contextforge.learnFromError", wrap((b) => learnFromError(b)));

  register("contextforge.openDashboard", async () => {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage("ContextForge: workspace is not trusted.");
      return;
    }
    DashboardPanel.open(backend, () => treeProvider.refresh());
  });
}
