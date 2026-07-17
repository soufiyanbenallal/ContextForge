import { Repositories } from "@contextforge/database";
import {
  KnowledgeCategory,
  KnowledgeScope,
  FeedbackClassification,
  FeedbackRecord,
  KnowledgeItem,
} from "@contextforge/shared";
import { conflictsWithCandidate } from "../conflicts/detect.js";

export interface ProposedLesson {
  scope: KnowledgeScope;
  category: KnowledgeCategory;
  title: string;
  content: string;
  priority: number;
  confidence: number;
  appliesTo: string | null;
}

const CATEGORY_BY_CLASSIFICATION: Record<
  FeedbackClassification,
  KnowledgeCategory
> = {
  "incorrect-code": "coding-rule",
  "violated-architecture": "architecture",
  "ignored-request": "user-preference",
  "outdated-api": "coding-rule",
  "unnecessary-complexity": "coding-rule",
  "wrong-tool": "skill",
  other: "user-preference",
};

const SCOPE_BY_LABEL: Record<string, KnowledgeScope> = {
  task: "task",
  project: "project",
  all: "global",
  global: "global",
};

export function extractLesson(
  feedback: FeedbackRecord,
  options: {
    scopeLabel?: "task" | "project" | "all";
    categoryOverride?: KnowledgeCategory;
    appliesTo?: string | null;
  } = {}
): ProposedLesson {
  const category =
    options.categoryOverride ??
    (feedback.classification
      ? CATEGORY_BY_CLASSIFICATION[feedback.classification]
      : "user-preference");

  const scope = options.scopeLabel
    ? SCOPE_BY_LABEL[options.scopeLabel] ?? "project"
    : "project";

  const title =
    feedback.message.length > 80
      ? feedback.message.slice(0, 77).trimEnd() + "..."
      : feedback.message;

  const priority =
    feedback.severity === "critical"
      ? 95
      : feedback.severity === "high"
        ? 80
        : feedback.severity === "low"
          ? 40
          : 60;

  return {
    scope,
    category,
    title,
    content: feedback.message,
    priority,
    confidence: 0.5,
    appliesTo: options.appliesTo ?? null,
  };
}

export function proposeLessonFromFeedback(
  repos: Repositories,
  feedbackId: string,
  options: Parameters<typeof extractLesson>[1] = {}
) {
  const feedback = repos.getFeedback(feedbackId);
  if (!feedback) throw new Error(`Feedback ${feedbackId} not found`);
  const lesson = extractLesson(feedback, options);
  const item = repos.createKnowledge({
    projectId: feedback.projectId,
    scope: lesson.scope,
    category: lesson.category,
    title: lesson.title,
    content: lesson.content,
    status: "proposed",
    priority: lesson.priority,
    confidence: lesson.confidence,
    sourceType: "feedback",
    sourceId: feedback.id,
    appliesTo: lesson.appliesTo,
  });
  const detected = conflictsWithCandidate(repos, item, feedback.projectId);
  const conflicts = detected.map((d) =>
    repos.createConflict({
      projectId: feedback.projectId,
      leftItemId: d.leftItemId,
      rightItemId: d.rightItemId,
      conflictType: d.conflictType,
      explanation: d.explanation,
    })
  );
  return { item, conflicts };
}

export interface SupersedeResult {
  old: KnowledgeItem;
  next: KnowledgeItem;
}

export function supersedeRule(
  repos: Repositories,
  oldId: string,
  newId: string,
  resolution?: string | null
): SupersedeResult {
  const result = repos.supersedeKnowledge(oldId, newId, resolution);
  if (!result) throw new Error("Supersede failed: rule not found");
  const open = repos.conflictsForItem(oldId);
  for (const c of open) {
    repos.resolveConflict(c.id, resolution ?? "Resolved by supersession");
  }
  return result;
}
