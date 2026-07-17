import { Repositories } from "@contextforge/database";
import {
  FeedbackClassification,
  KnowledgeCategory,
  FeedbackRecord,
} from "@contextforge/shared";
import { proposeLessonFromFeedback } from "./extract.js";

export type FaultKind =
  | "build"
  | "test"
  | "lint"
  | "typecheck"
  | "runtime"
  | "rejected-edit"
  | "other";

const CLASSIFICATION_BY_FAULT: Record<FaultKind, FeedbackClassification> = {
  build: "incorrect-code",
  test: "incorrect-code",
  lint: "incorrect-code",
  typecheck: "incorrect-code",
  runtime: "incorrect-code",
  "rejected-edit": "ignored-request",
  other: "other",
};

const SEVERITY_BY_FAULT: Record<FaultKind, FeedbackRecord["severity"]> = {
  build: "high",
  test: "high",
  lint: "normal",
  typecheck: "high",
  runtime: "critical",
  "rejected-edit": "normal",
  other: "normal",
};

export interface CaptureFaultInput {
  projectId: string;
  kind: FaultKind;
  message: string;
  detail?: string;
  source?: string | null;
  appliesTo?: string | null;
}

export interface CaptureFaultResult {
  feedback: FeedbackRecord;
  knowledgeId: string;
  conflicts: unknown[];
  reinforcedMissId: string | null;
}

/**
 * Records a fault as feedback and immediately proposes a lesson from it.
 * This is the core "learn from fault" step: no manual propose needed.
 */
export function captureFault(
  repos: Repositories,
  input: CaptureFaultInput
): CaptureFaultResult {
  const feedback = repos.recordFeedback({
    projectId: input.projectId,
    feedbackType: "fault",
    message: input.detail ? `${input.message}\n\n${input.detail}` : input.message,
    severity: SEVERITY_BY_FAULT[input.kind],
    classification: CLASSIFICATION_BY_FAULT[input.kind],
    interactionId: input.source ?? null,
  });

  const { item, conflicts } = proposeLessonFromFeedback(repos, feedback.id, {
    scopeLabel: "project",
    appliesTo: input.appliesTo ?? null,
  });

  // Closed learning loop: if an approved lesson already covered this kind of
  // fault, it failed to prevent it -> decay its confidence and surface the gap
  // as a correction candidate (so the user can tighten the rule).
  const match = findSimilarApproved(repos, input.projectId, input.message);
  if (match) {
    repos.recordKnowledgeHit(match.id, "miss");
  }

  return { feedback, knowledgeId: item.id, conflicts, reinforcedMissId: match?.id ?? null };
}

function findSimilarApproved(
  repos: Repositories,
  projectId: string,
  message: string
): { id: string } | null {
  const approved = repos
    .listKnowledge({ projectId, status: "approved" })
    .concat(repos.listKnowledge({ projectId: null, status: "approved" }));
  const words = new Set(
    message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
  );
  let best: { id: string; score: number } | null = null;
  for (const a of approved) {
    const text = (a.title + " " + a.content).toLowerCase();
    let score = 0;
    for (const w of words) if (text.includes(w)) score++;
    if (score > 0 && (!best || score > best.score)) best = { id: a.id, score };
  }
  return best && best.score >= 2 ? { id: best.id } : null;
}

/**
 * Turns any existing feedback into a proposed lesson (used by the Dashboard
 * "Extract lesson" button). Returns alreadyExists if a lesson was made before.
 */
export function autoLearn(
  repos: Repositories,
  feedbackId: string,
  options: {
    scopeLabel?: "task" | "project" | "all";
    appliesTo?: string | null;
  } = {}
): { knowledgeId: string; conflicts: unknown[] } | { alreadyExists: true } {
  const fb = repos.getFeedback(feedbackId);
  if (!fb) throw new Error(`Feedback ${feedbackId} not found`);
  const existing = repos
    .listKnowledge({ projectId: fb.projectId })
    .find((k) => k.sourceId === feedbackId && k.sourceType === "feedback");
  if (existing) return { alreadyExists: true };
  const { item, conflicts } = proposeLessonFromFeedback(repos, feedbackId, options);
  return { knowledgeId: item.id, conflicts };
}
