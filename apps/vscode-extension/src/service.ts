import type { Repositories } from "@contextforge/database";
import type {
  KnowledgeItem,
  ConflictRecord,
  CapabilityRecord,
  KnowledgeCategory,
} from "@contextforge/shared";
import { autoLearn, proposeLessonFromFeedback } from "@contextforge/core";

/**
 * VS Code–free logic behind the Inbox UI: builds the view state and applies
 * user actions. Kept separate so it can be unit-tested without an editor.
 */

export interface RuleView extends KnowledgeItem {
  sourceMessage: string | null;
  conflictIds: string[];
}

export interface ConflictView {
  id: string;
  type: string;
  explanation: string | null;
  left: KnowledgeItem | null;
  right: KnowledgeItem | null;
}

export interface FaultView {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
}

export interface InboxState {
  projectName: string;
  rootPath: string;
  proposed: RuleView[];
  approved: RuleView[];
  history: RuleView[];
  conflicts: ConflictView[];
  capabilities: (CapabilityRecord & { missing: string[] })[];
  faults: FaultView[];
}

export function buildState(
  repos: Repositories,
  project: { projectId: string; rootPath: string }
): InboxState {
  const open = repos.listConflicts(project.projectId, "open");
  const byItem = new Map<string, string[]>();
  for (const c of open) {
    for (const id of [c.leftItemId, c.rightItemId]) {
      byItem.set(id, [...(byItem.get(id) ?? []), c.id]);
    }
  }
  const decorate = (i: KnowledgeItem): RuleView => ({
    ...i,
    sourceMessage:
      i.sourceType === "feedback" && i.sourceId
        ? (repos.getFeedback(i.sourceId)?.message ?? null)
        : null,
    conflictIds: byItem.get(i.id) ?? [],
  });
  const list = (status: KnowledgeItem["status"]) =>
    repos.listKnowledge({ projectId: project.projectId, status }).map(decorate);

  return {
    projectName: project.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? project.rootPath,
    rootPath: project.rootPath,
    proposed: list("proposed"),
    approved: list("approved"),
    history: [...list("rejected"), ...list("superseded")],
    conflicts: open.map(
      (c: ConflictRecord): ConflictView => ({
        id: c.id,
        type: c.conflictType,
        explanation: c.explanation,
        left: repos.getKnowledge(c.leftItemId),
        right: repos.getKnowledge(c.rightItemId),
      })
    ),
    capabilities: repos.listCapabilities().map((c) => ({
      ...c,
      missing: repos.validateCapabilityConfig(c.id).missing,
    })),
    faults: repos
      .listFeedback(project.projectId, 25)
      .map((f) => ({
        id: f.id,
        type: f.feedbackType,
        severity: f.severity,
        message: f.message,
        createdAt: f.createdAt,
      })),
  };
}

export type InboxAction =
  | { act: "approve"; ids: string[] }
  | { act: "reject"; ids: string[]; reason?: string }
  | { act: "setStatus"; ids: string[]; status: "proposed" | "approved" }
  | {
      act: "edit";
      id: string;
      title?: string;
      content: string;
      appliesTo?: string | null;
      category?: KnowledgeCategory;
      approve?: boolean;
    }
  | { act: "supersede"; id: string; content: string }
  | {
      act: "resolve";
      id: string;
      winner: "left" | "right" | "both" | "dismiss";
    }
  | { act: "extract"; id: string }
  | { act: "capability"; id: string; enabled: boolean };

export interface ActionResult {
  message?: string;
  /** Action that reverses this one, offered to the user as "Undo". */
  undo?: InboxAction;
}

export function applyAction(
  repos: Repositories,
  action: InboxAction
): ActionResult {
  switch (action.act) {
    case "approve": {
      for (const id of action.ids) repos.updateKnowledgeStatus(id, "approved");
      return {
        message: `Approved ${action.ids.length} lesson(s)`,
        undo: { act: "setStatus", ids: action.ids, status: "proposed" },
      };
    }
    case "reject": {
      for (const id of action.ids)
        repos.updateKnowledgeStatus(id, "rejected", { reason: action.reason ?? null });
      return {
        message: `Rejected ${action.ids.length} lesson(s)`,
        undo: { act: "setStatus", ids: action.ids, status: "proposed" },
      };
    }
    case "setStatus": {
      for (const id of action.ids) repos.updateKnowledgeStatus(id, action.status);
      return { message: "Restored" };
    }
    case "edit": {
      const content = action.content.trim();
      if (!content) throw new Error("Rule text cannot be empty");
      repos.editKnowledge(action.id, {
        title: action.title?.trim() || content.slice(0, 80),
        content,
        appliesTo: action.appliesTo === undefined ? undefined : action.appliesTo?.trim() || null,
        category: action.category,
      });
      if (action.approve) repos.updateKnowledgeStatus(action.id, "approved");
      return {
        message: action.approve ? "Edited and approved" : "Saved",
        undo: action.approve
          ? { act: "setStatus", ids: [action.id], status: "proposed" }
          : undefined,
      };
    }
    case "supersede": {
      const old = repos.getKnowledge(action.id);
      const content = action.content.trim();
      if (!old || !content) throw new Error("Nothing to supersede");
      const next = repos.createKnowledge({
        projectId: old.projectId,
        scope: old.scope,
        category: old.category,
        title: content.slice(0, 80),
        content,
        status: "approved",
        priority: old.priority,
        confidence: old.confidence,
        appliesTo: old.appliesTo,
        sourceType: "manual",
      });
      repos.supersedeKnowledge(old.id, next.id, "Superseded from Inbox");
      for (const c of repos.conflictsForItem(old.id)) {
        repos.resolveConflict(c.id, "Resolved by supersession");
      }
      return { message: "Rule replaced" };
    }
    case "resolve": {
      const c = repos.getConflict(action.id);
      if (!c) throw new Error("Conflict not found");
      switch (action.winner) {
        case "left":
          repos.resolveConflict(c.id, "Kept left rule", null, c.rightItemId);
          break;
        case "right":
          repos.resolveConflict(c.id, "Kept right rule", c.leftItemId, null);
          break;
        case "both":
          repos.resolveConflict(c.id, "Both rules kept (conflict accepted)");
          break;
        case "dismiss":
          repos.resolveConflict(c.id, "Dismissed as not a real conflict");
          break;
      }
      return { message: "Conflict resolved" };
    }
    case "extract": {
      const res = autoLearn(repos, action.id, { scopeLabel: "project" });
      return {
        message:
          "alreadyExists" in res
            ? "A lesson was already extracted from this item"
            : "Lesson proposed — see Inbox",
      };
    }
    case "capability": {
      repos.setCapabilityEnabled(action.id, action.enabled);
      return { message: action.enabled ? "Enabled" : "Disabled" };
    }
  }
}

/**
 * "Teach ContextForge": record a correction (optionally tied to the code the
 * user selected) and turn it into a proposed lesson scoped to `appliesTo`.
 */
export function teach(
  repos: Repositories,
  projectId: string,
  input: { message: string; appliesTo?: string | null; evidence?: string | null }
): { itemId: string; feedbackId: string; conflicts: number } {
  const message = input.message.trim();
  if (!message) throw new Error("Describe what the agent should do differently");
  const text = input.evidence?.trim()
    ? `${message}\n\nExample of the mistake:\n${input.evidence.trim().slice(0, 1500)}`
    : message;
  const fb = repos.recordFeedback({
    projectId,
    feedbackType: "correction",
    message: text,
    severity: "normal",
    classification: "other",
  });
  const { item, conflicts } = proposeLessonFromFeedback(repos, fb.id, {
    scopeLabel: "project",
    appliesTo: input.appliesTo ?? null,
  });
  // The lesson itself should be the clean instruction, not the evidence blob.
  repos.editKnowledge(item.id, { title: message.slice(0, 80), content: message }, "Teach");
  return { itemId: item.id, feedbackId: fb.id, conflicts: conflicts.length };
}
