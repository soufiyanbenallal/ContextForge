import { Repositories } from "@contextforge/database";
import { KnowledgeItem, splitPatterns, KnowledgeScope } from "@contextforge/shared";

export interface GetContextInput {
  projectId: string;
  task?: string;
  files?: string[];
  maxItems?: number;
}

export interface ContextResult {
  requiredRules: KnowledgeItem[];
  relevantDecisions: KnowledgeItem[];
  failedApproaches: KnowledgeItem[];
  recommendedSkills: string[];
  warnings: string[];
  conflicts: {
    id: string;
    leftId: string;
    rightId: string;
    type: string;
    explanation: string | null;
  }[];
}

const SCOPE_RANK: Record<KnowledgeScope, number> = {
  task: 100,
  directory: 80,
  project: 60,
  language: 40,
  workspace: 20,
  global: 10,
};

function appliesToFiles(item: KnowledgeItem, files: string[]): boolean {
  const patterns = splitPatterns(item.appliesTo);
  if (patterns.length === 0) return files.length === 0;
  return files.some((f) =>
    patterns.some((p) => matchPattern(f, p))
  );
}

function matchPattern(file: string, pattern: string): boolean {
  const norm = file.replace(/\\/g, "/");
  const p = pattern.trim().replace(/\\/g, "/");
  if (p.endsWith("/**")) {
    const base = p.slice(0, -3);
    return norm === base || norm.startsWith(base + "/");
  }
  if (p.includes("*")) {
    const re = new RegExp(
      "^" + p.split("*").map(escapeRe).join(".*") + "$"
    );
    return re.test(norm);
  }
  return norm === p || norm.startsWith(p + "/");
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function getContext(
  repos: Repositories,
  input: GetContextInput
): ContextResult {
  const max = input.maxItems ?? 12;
  const warnings: string[] = [];
  const files = (input.files ?? []).map((f) => f.replace(/\\/g, "/"));

  const approved = repos.listKnowledge({
    projectId: input.projectId,
    status: "approved",
  });

  const globalApproved = repos.listKnowledge({
    projectId: null,
    status: "approved",
  });

  const allApproved = [...approved, ...globalApproved];

  const fileScoped = files.length
    ? allApproved.filter((i) => appliesToFiles(i, files))
    : allApproved;

  const requiredRules = fileScoped
    .filter((i) => i.category === "coding-rule" || i.category === "security-rule")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  const relevantDecisions = allApproved
    .filter((i) => i.category === "project-decision" || i.category === "architecture")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  const failedApproaches = allApproved
    .filter((i) => i.category === "failed-approach")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  // recommended skills (approved skill/mcp items + registry match)
  const recommendedSkills = allApproved
    .filter((i) => i.category === "skill" || i.category === "mcp")
    .map((i) => i.title);

  const conflicts = repos
    .listConflicts(input.projectId, "open")
    .map((c) => ({
      id: c.id,
      leftId: c.leftItemId,
      rightId: c.rightItemId,
      type: c.conflictType,
      explanation: c.explanation,
    }));

  if (conflicts.length) {
    warnings.push(
      `Found ${conflicts.length} unresolved rule conflict(s). Review before editing.`
    );
  }

  return {
    requiredRules,
    relevantDecisions,
    failedApproaches,
    recommendedSkills,
    warnings,
    conflicts,
  };
}

export { SCOPE_RANK };
