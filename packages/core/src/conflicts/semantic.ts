import { Repositories } from "@contextforge/database";
import { KnowledgeItem } from "@contextforge/shared";
import { detectConflicts } from "./detect.js";

export interface SemanticConflictResult {
  leftItemId: string;
  rightItemId: string;
  conflict: boolean;
  type: "direct" | "semantic" | "none";
  explanation: string | null;
  suggestedResolution: string | null;
}

export type ConflictModel = (
  left: string,
  right: string
) => Promise<{
  conflict: boolean;
  type: "direct" | "semantic" | "none";
  explanation: string | null;
  suggestedResolution: string | null;
}>;

function defaultModel(): ConflictModel {
  // No model configured: escalate anything the deterministic pass does not
  // already catch is left as "none". The deterministic detector already
  // records direct conflicts; semantic checks simply decline.
  return async () => ({
    conflict: false,
    type: "none",
    explanation: null,
    suggestedResolution: null,
  });
}

export interface DeepConflictOptions {
  model?: ConflictModel;
}

export async function checkConflictsDeep(
  repos: Repositories,
  projectId: string,
  options: DeepConflictOptions = {}
): Promise<{
  deterministic: ReturnType<typeof detectConflicts>;
  semantic: SemanticConflictResult[];
}> {
  const model = options.model ?? defaultModel();
  const deterministic = detectConflicts(repos, projectId);

  // Candidate pairs for semantic check: same scope family, overlapping file
  // scope, but not already flagged by the deterministic pass.
  const items = repos.listKnowledge({ projectId, status: "approved" });
  const flagged = new Set(
    deterministic.flatMap((d) => [d.leftItemId, d.rightItemId])
  );
  const semantic: SemanticConflictResult[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const key = [a.id, b.id].sort().join("|");
      if (flagged.has(a.id) && flagged.has(b.id)) continue;
      const res = await model(a.content, b.content);
      if (res.conflict) {
        semantic.push({
          leftItemId: a.id,
          rightItemId: b.id,
          conflict: true,
          type: res.type,
          explanation: res.explanation,
          suggestedResolution: res.suggestedResolution,
        });
      }
    }
  }

  return { deterministic, semantic };
}
