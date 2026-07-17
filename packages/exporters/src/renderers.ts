import { KnowledgeItem } from "@contextforge/shared";

export function renderPromptMd(
  slug: string,
  title: string,
  body: string
): string {
  return `---
description: ${title}
mode: ${slug === "review-feedback" ? "agent" : "ask"}
---
# ${title}

${body}
`;
}

export function renderReviewFeedbackPrompt(items: KnowledgeItem[]): string {
  const rules = items
    .filter((i) => i.status === "approved")
    .map((i) => `- [${i.category}] ${i.content}`)
    .join("\n");
  const body = `You are reviewing a code change for this project. Before approving, check the
change against the project's approved rules and rejected approaches below.
If the change violates a rule, reject it and cite the rule.

## Approved project rules
${rules || "(none)"}

## Steps
1. Read the diff.
2. Compare each change against the rules above.
3. Reject if it contradicts an approved rule or repeats a rejected approach.
4. Summarize what was checked.`;
  return renderPromptMd("review-feedback", "Review against project feedback", body);
}

export function renderCheckConflictsPrompt(): string {
  const body = `You are checking a set of proposed project rules for mutual conflicts.

## Steps
1. Read each candidate rule.
2. Determine whether any pair cannot both be followed in the same scope.
3. For each conflict, state the two rules, the conflict type, and a suggested
   resolution that keeps the higher-precedence rule.
4. Return the conflicts as structured data.`;
  return renderPromptMd("check-conflicts", "Check rule conflicts", body);
}

export function renderAgentMd(
  slug: string,
  title: string,
  description: string,
  instructions: string[]
): string {
  return `---
name: ${slug}
description: ${description}
tools: ['*']
---
# ${title}

${instructions.map((i) => `- ${i}`).join("\n")}
`;
}

export function renderProjectReviewerAgent(items: KnowledgeItem[]): string {
  const rules = items
    .filter((i) => i.status === "approved")
    .map((i) => `- ${i.content}`)
    .join("\n");
  const instructions = [
    "You are a project reviewer that enforces this project's approved rules.",
    "Before approving any change, verify it does not violate an approved rule.",
    "Never suggest approaches listed under rejected approaches.",
    "When uncertain, ask the user rather than guessing project conventions.",
    "",
    "## Approved rules",
    rules || "(none yet)",
  ];
  return renderAgentMd(
    "project-reviewer",
    "Project Reviewer",
    "Reviews changes against approved project rules and rejected approaches.",
    instructions
  );
}

export function renderSkillMd(item: KnowledgeItem): string {
  return `---
name: ${item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}
description: ${item.content}
---
# ${item.title}

${item.content}

${item.appliesTo ? `\nApplies to: \`${item.appliesTo}\`` : ""}
`;
}
