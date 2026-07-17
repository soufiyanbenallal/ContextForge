import { KnowledgeItem } from "@contextforge/shared";

export function groupByCategory(
  items: KnowledgeItem[]
): Map<string, KnowledgeItem[]> {
  const map = new Map<string, KnowledgeItem[]>();
  for (const i of items) {
    const arr = map.get(i.category) ?? [];
    arr.push(i);
    map.set(i.category, arr);
  }
  return map;
}

const CATEGORY_HEADINGS: Record<string, string> = {
  architecture: "Required architecture",
  "coding-rule": "Coding rules",
  "security-rule": "Security rules",
  "user-preference": "User preferences",
  "failed-approach": "Rejected approaches",
  "accepted-pattern": "Accepted patterns",
  "project-decision": "Project decisions",
  "dependency-guide": "Dependency guidance",
  workflow: "Workflows",
  skill: "Skills",
  mcp: "MCP servers",
};

export function renderAgentsMd(items: KnowledgeItem[]): string {
  const approved = items.filter((i) => i.status === "approved");
  const byCat = groupByCategory(approved);
  const lines: string[] = ["# Project Rules", ""];

  for (const [cat, catItems] of byCat) {
    const heading = CATEGORY_HEADINGS[cat] ?? cat;
    lines.push(`## ${heading}`, "");
    for (const item of catItems.sort((a, b) => b.priority - a.priority)) {
      let line = `- ${item.content}`;
      if (item.appliesTo) line += `  _(applies to: ${item.appliesTo})_`;
      lines.push(line);
    }
    lines.push("");
  }

  const failed = approved.filter((i) => i.category === "failed-approach");
  if (failed.length) {
    lines.push("## Before editing", "");
    lines.push("1. Search existing project decisions.");
    lines.push("2. Check whether the requested change conflicts with an approved rule.");
    lines.push("3. Reuse existing project types and naming.");
    lines.push("4. Mention unresolved conflicts before modifying code.");
    lines.push("");
  }

  return lines.join("\n");
}

export function renderInstructionMd(
  items: KnowledgeItem[],
  title: string
): string {
  const approved = items.filter((i) => i.status === "approved");
  const lines: string[] = [`# ${title}`, ""];
  for (const item of approved.sort((a, b) => b.priority - a.priority)) {
    lines.push(`- ${item.content}`);
  }
  lines.push("");
  return lines.join("\n");
}
