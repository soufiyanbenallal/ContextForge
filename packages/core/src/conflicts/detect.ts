import { Repositories } from "@contextforge/database";
import { KnowledgeItem, splitPatterns } from "@contextforge/shared";

export interface DetectedConflict {
  leftItemId: string;
  rightItemId: string;
  conflictType: "direct" | "precedence";
  explanation: string;
}

const OPPOSITE_MARKERS: { pos: string[]; neg: string[] }[] = [
  { pos: ["use uuid", "uuid primary"], neg: ["auto-increment", "autoincrement", "serial primary"] },
  { pos: ["never use repository", "no repository"], neg: ["must use", "through repository", "repository class"] },
  { pos: ["only use", "use only"], neg: ["also use", "additionally use", "another"] },
];

const RULE_FAMILY = new Set([
  "architecture",
  "coding-rule",
  "security-rule",
]);

function categoriesCanConflict(a: KnowledgeItem, b: KnowledgeItem): boolean {
  // Rules within the same family always can conflict.
  if (a.category === b.category) return true;
  // Architecture-family rules can conflict with each other.
  if (RULE_FAMILY.has(a.category) && RULE_FAMILY.has(b.category)) return true;
  return false;
}

function scopeOverlap(a: KnowledgeItem, b: KnowledgeItem): boolean {
  if (a.projectId && b.projectId && a.projectId !== b.projectId) return false;
  const aFiles = splitPatterns(a.appliesTo);
  const bFiles = splitPatterns(b.appliesTo);
  if (aFiles.length === 0 || bFiles.length === 0) return true;
  return aFiles.some((ap) =>
    bFiles.some((bp) => ap === bp || ap.startsWith(bp) || bp.startsWith(ap))
  );
}

// Subject tokens that indicate the two rules are about the SAME decision.
// If both target the same subject but prescribe different concrete choices,
// that is a likely direct conflict.
const SUBJECT_KEYS: { key: string; choices: string[] }[] = [
  { key: "primary key", choices: ["uuid", "auto-increment", "autoincrement", "serial", "integer", "increment"] },
  { key: "translation", choices: ["form_locales", "form_translations", "another translation", "separate translation", "additional translation"] },
  { key: "repository", choices: ["repository", "no repository", "never use repository"] },
];

function textConflicts(a: KnowledgeItem, b: KnowledgeItem): boolean {
  const ta = a.content.toLowerCase() + " " + a.title.toLowerCase();
  const tb = b.content.toLowerCase() + " " + b.title.toLowerCase();

  for (const pair of OPPOSITE_MARKERS) {
    const aPos = pair.pos.some((m) => ta.includes(m));
    const aNeg = pair.neg.some((m) => ta.includes(m));
    const bPos = pair.pos.some((m) => tb.includes(m));
    const bNeg = pair.neg.some((m) => tb.includes(m));
    if ((aPos && bNeg) || (bPos && aNeg)) return true;
  }

  // Subject-based: same topic, different prescribed choice.
  for (const subj of SUBJECT_KEYS) {
    if (!ta.includes(subj.key) || !tb.includes(subj.key)) continue;
    const aChoices = subj.choices.filter((c) => ta.includes(c));
    const bChoices = subj.choices.filter((c) => tb.includes(c));
    if (aChoices.length && bChoices.length) {
      const overlap = aChoices.some((c) => bChoices.includes(c));
      if (!overlap) return true;
    }
  }

  return false;
}

export function detectConflicts(
  repos: Repositories,
  projectId: string
): DetectedConflict[] {
  const approved = repos.listKnowledge({
    projectId,
    status: "approved",
  });
  const globalApproved = repos.listKnowledge({
    projectId: null,
    status: "approved",
  });
  const items = [...approved, ...globalApproved];
  const found: DetectedConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (!categoriesCanConflict(a, b)) continue;
      if (!scopeOverlap(a, b)) continue;
      if (!textConflicts(a, b)) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        leftItemId: a.id,
        rightItemId: b.id,
        conflictType: "direct",
        explanation: `Both rules apply to overlapping scope/category and express contradictory guidance: "${a.title}" vs "${b.title}".`,
      });
    }
  }
  return found;
}

export function conflictsWithCandidate(
  repos: Repositories,
  candidate: KnowledgeItem,
  projectId: string
): DetectedConflict[] {
  const approved = repos.listKnowledge({ projectId, status: "approved" });
  const globalApproved = repos.listKnowledge({
    projectId: null,
    status: "approved",
  });
  const items = [...approved, ...globalApproved];
  const found: DetectedConflict[] = [];

  for (const other of items) {
    if (other.id === candidate.id) continue;
    if (!categoriesCanConflict(candidate, other)) continue;
    if (!scopeOverlap(candidate, other)) continue;
    if (!textConflicts(candidate, other)) continue;
    found.push({
      leftItemId: candidate.id,
      rightItemId: other.id,
      conflictType: "direct",
      explanation: `Proposed lesson conflicts with existing approved rule: "${candidate.title}" vs "${other.title}".`,
    });
  }
  return found;
}
