import * as vscode from "vscode";
import { Backend } from "./backend.js";
import {
  FeedbackClassification,
  KnowledgeScope,
} from "@contextforge/shared";
import { InboxPanel } from "./inbox.js";
import { showDiff, virtualUri } from "./virtual-docs.js";
import { teach } from "./service.js";
import { planConnect, verifyServer, TARGETS, AgentTarget } from "./connect.js";
import { exportForProject } from "@contextforge/exporters";
import { getContext } from "@contextforge/core";
import { dirname, extname, relative, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { matchesAppliesTo } from "./glob.js";

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

const channels = new Map<string, vscode.OutputChannel>();
function channel(name: string): vscode.OutputChannel {
  let c = channels.get(name);
  if (!c) {
    c = vscode.window.createOutputChannel(name);
    channels.set(name, c);
  }
  return c;
}

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
  const panel = channel("ContextForge");
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

/** The tree passes the clicked node; the dashboard/palette pass nothing. */
function nodeItemId(node: unknown): string | undefined {
  const n = node as { kind?: string; item?: { id?: string } } | undefined;
  return n?.kind === "rule" ? n.item?.id : undefined;
}

async function reviewProposedLessons(
  backend: Backend,
  forceAction?: "approve" | "reject",
  node?: unknown
) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const clickedId = nodeItemId(node);
  if (clickedId && forceAction) {
    await resolveLesson(backend, clickedId, forceAction);
    backend.refresh();
    return;
  }
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
  if (action) await resolveLesson(backend, pick.id, action);
  backend.refresh();
}

async function resolveLesson(backend: Backend, id: string, action: "approve" | "reject") {
  if (action === "approve") {
    backend.repos.updateKnowledgeStatus(id, "approved");
    vscode.window.showInformationMessage("ContextForge: lesson approved.");
    return;
  }
  const reason = await vscode.window.showInputBox({ prompt: "Reason for rejection (optional)" });
  if (reason === undefined) return; // user cancelled: leave the lesson untouched
  backend.repos.updateKnowledgeStatus(id, "rejected", { reason: reason || null });
  vscode.window.showInformationMessage("ContextForge: lesson rejected.");
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
  const rel = relative(proj.rootPath, file);
  const items = backend.repos.listKnowledge({
    projectId: proj.projectId,
    status: "approved",
  });
  const matching = items.filter((i) => matchesAppliesTo(i.appliesTo, rel));
  const panel = channel("ContextForge");
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
  // Native diff editor for every changed file; nothing is written until the
  // user confirms which files to apply.
  const emptyDoc = virtualUri("empty", "");
  const toOpen = changes.slice(0, 8);
  for (const f of toOpen) {
    const rel = relative(proj.rootPath, f.path);
    const left = f.exists ? vscode.Uri.file(f.path) : emptyDoc;
    const right = virtualUri(rel, f.content);
    await showDiff(left, right, `ContextForge export: ${rel}${f.exists ? "" : " (new)"}`);
  }
  const picks = await vscode.window.showQuickPick(
    changes.map((f) => ({
      label: relative(proj.rootPath, f.path),
      description: f.exists ? "modified" : "new file",
      picked: true,
      file: f,
    })),
    {
      canPickMany: true,
      title: "Apply export — pick the files to write (diffs are open in the editor)",
      placeHolder: "Deselect any file you don't want written. Esc cancels.",
    }
  );
  if (!picks || picks.length === 0) {
    vscode.window.showInformationMessage("ContextForge: export cancelled (no files written).");
    return;
  }
  const written = applyExport(picks.map((p) => p.file));
  vscode.window.showInformationMessage(`ContextForge: wrote ${written.length} file(s).`);
}

async function openConflictDiff(backend: Backend, conflictId?: string) {
  const proj = await requireProject(backend);
  if (!proj) return;
  let id = conflictId;
  if (!id) {
    const open = backend.repos.listConflicts(proj.projectId, "open");
    if (open.length === 0) {
      vscode.window.showInformationMessage("ContextForge: no open conflicts.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      open.map((c) => ({ label: c.explanation ?? c.conflictType, id: c.id })),
      { title: "Compare conflicting rules" }
    );
    id = pick?.id;
  }
  if (!id) return;
  const c = backend.repos.getConflict(id);
  const left = c && backend.repos.getKnowledge(c.leftItemId);
  const right = c && backend.repos.getKnowledge(c.rightItemId);
  if (!c || !left || !right) {
    vscode.window.showErrorMessage("ContextForge: conflict not found.");
    return;
  }
  const fmt = (r: typeof left) =>
    `# ${r.title}\n\nstatus: ${r.status}\nscope: ${r.scope}\ncategory: ${r.category}\npriority: ${r.priority}\napplies to: ${r.appliesTo ?? "(whole project)"}\n\n${r.content}\n`;
  await showDiff(
    virtualUri("rule-A.md", fmt(left)),
    virtualUri("rule-B.md", fmt(right)),
    `Conflict: rule A ↔ rule B — ${c.explanation ?? c.conflictType}`
  );
}

async function teachCommand(backend: Backend) {
  const proj = await requireProject(backend);
  if (!proj) return;
  const editor = vscode.window.activeTextEditor;
  const evidence =
    editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : null;
  const message = await vscode.window.showInputBox({
    title: "Teach ContextForge",
    prompt: "What should the agent do (or not do) differently?",
    placeHolder: "e.g. Never add a third translation table; use form_translations only.",
    ignoreFocusOut: true,
  });
  if (!message?.trim()) return;

  const scopes: { label: string; description?: string; appliesTo: string | null }[] = [
    { label: "Whole project", appliesTo: null },
  ];
  if (editor && editor.document.uri.scheme === "file") {
    const rel = relative(proj.rootPath, editor.document.uri.fsPath).replace(/\\/g, "/");
    if (!rel.startsWith("..")) {
      const dir = dirname(rel);
      scopes.unshift({ label: "This file", description: rel, appliesTo: rel });
      if (dir && dir !== ".") {
        scopes.splice(1, 0, { label: "This folder", description: `${dir}/**`, appliesTo: `${dir}/**` });
      }
      const ext = extname(rel);
      if (ext) scopes.push({ label: `All ${ext} files`, description: `**/*${ext}`, appliesTo: `**/*${ext}` });
    }
  }
  const scope =
    scopes.length === 1
      ? scopes[0]
      : await vscode.window.showQuickPick(scopes, { title: "Where does this apply?", ignoreFocusOut: true });
  if (!scope) return;

  const res = teach(backend.repos, proj.projectId, {
    message,
    appliesTo: scope.appliesTo,
    evidence,
  });
  backend.refresh();
  const choice = await vscode.window.showInformationMessage(
    `ContextForge: lesson proposed${res.conflicts ? ` (${res.conflicts} conflict${res.conflicts === 1 ? "" : "s"} found)` : ""}. Review it in the Inbox.`,
    "Open Inbox"
  );
  if (choice === "Open Inbox") InboxPanel.open(backend);
}

async function connectAgents(backend: Backend, extensionPath: string) {
  const proj = await requireProject(backend);
  if (!proj) return;
  if (!vscode.workspace.isTrusted) {
    vscode.window.showErrorMessage("ContextForge: workspace is not trusted; refusing to write files.");
    return;
  }
  const serverPath = join(extensionPath, "dist", "mcp-server.cjs");
  if (!existsSync(serverPath)) {
    vscode.window.showErrorMessage(`ContextForge: bundled MCP server not found at ${serverPath}.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    (Object.keys(TARGETS) as AgentTarget[]).map((t) => ({
      label: TARGETS[t].label,
      description: TARGETS[t].file,
      picked: t !== "cursor",
      target: t,
    })),
    { canPickMany: true, title: "Connect which agents to ContextForge?" }
  );
  if (!picked || picked.length === 0) return;

  let plan;
  try {
    plan = planConnect(proj.rootPath, picked.map((p) => p.target), serverPath, backend.dbPath);
  } catch (err) {
    vscode.window.showErrorMessage(`ContextForge: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const changed = plan.filter((p) => p.changed);
  for (const p of changed) {
    const rel = relative(proj.rootPath, p.path);
    await showDiff(
      p.existing ? vscode.Uri.file(p.path) : virtualUri("empty", ""),
      virtualUri(rel, p.content),
      `Connect agents: ${rel}`
    );
  }
  if (changed.length) {
    const ok = await vscode.window.showInformationMessage(
      `ContextForge will write ${changed.length} MCP config file(s) (diffs are open). Continue?`,
      { modal: false },
      "Write files",
      "Cancel"
    );
    if (ok !== "Write files") return;
    for (const p of changed) {
      mkdirSync(dirname(p.path), { recursive: true });
      writeFileSync(p.path, p.content, "utf8");
    }
  }
  const check = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "ContextForge: verifying MCP server…" },
    () => verifyServer(serverPath, backend.dbPath)
  );
  const next = check.ok
    ? "Next, run “Export Instructions” so AGENTS.md tells agents to call memory_get_context."
    : "";
  if (check.ok) {
    const c = await vscode.window.showInformationMessage(
      `ContextForge: agents connected (${check.detail}). ${next}`,
      "Export Instructions"
    );
    if (c === "Export Instructions") await vscode.commands.executeCommand("contextforge.exportInstructions");
  } else {
    vscode.window.showErrorMessage(`ContextForge: MCP server check failed — ${check.detail}`);
  }
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
    (fn: (b: Backend, ...args: any[]) => Promise<void>) => async (...args: any[]) => {
      if (!vscode.workspace.isTrusted) {
        vscode.window.showErrorMessage("ContextForge: workspace is not trusted.");
        return;
      }
      await fn(backend, ...args);
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
  register("contextforge.approveLesson", wrap((b, node) => reviewProposedLessons(b, "approve", node)));
  register("contextforge.rejectLesson", wrap((b, node) => reviewProposedLessons(b, "reject", node)));
  register("contextforge.learnFromError", wrap((b) => learnFromError(b)));
  register("contextforge.teach", wrap((b) => teachCommand(b)));
  register("contextforge.openConflictDiff", wrap((b, id) => openConflictDiff(b, typeof id === "string" ? id : undefined)));
  register("contextforge.connectAgents", wrap((b) => connectAgents(b, context.extensionUri.fsPath)));

  register("contextforge.openDashboard", async () => {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage("ContextForge: workspace is not trusted.");
      return;
    }
    InboxPanel.open(backend);
  });
}
