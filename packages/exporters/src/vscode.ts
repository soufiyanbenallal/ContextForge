import { Repositories } from "@contextforge/database";
import { KnowledgeItem, splitPatterns } from "@contextforge/shared";
import { renderAgentsMd, renderInstructionMd } from "./agents-md.js";
import {
  renderReviewFeedbackPrompt,
  renderCheckConflictsPrompt,
  renderProjectReviewerAgent,
  renderSkillMd,
} from "./renderers.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PlannedFile {
  path: string;
  content: string;
  exists: boolean;
  diff: string | null;
}

function buildDiff(existing: string, next: string): string {
  const a = existing.split("\n");
  const b = next.split("\n");
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const la = a[i];
    const lb = b[j];
    if (la === lb) {
      out.push(`  ${la ?? ""}`);
      i++;
      j++;
    } else if (la !== undefined && (lb === undefined || b.indexOf(la, j) !== -1)) {
      out.push(`- ${la}`);
      i++;
    } else {
      out.push(`+ ${lb}`);
      j++;
    }
  }
  return out.slice(0, max).join("\n");
}

function planOne(rootPath: string, rel: string, content: string): PlannedFile {
  const path = join(rootPath, rel);
  const exists = existsSync(path);
  let diff: string | null = null;
  if (exists) {
    const current = readFileSync(path, "utf8");
    if (current !== content) diff = buildDiff(current, content);
  } else {
    // A file that doesn't exist yet is a change too (all additions); a null
    // diff means "unchanged", which previously hid brand-new files.
    diff = buildDiff("", content);
  }
  return { path, content, exists, diff };
}

export function planExport(
  repos: Repositories,
  projectId: string,
  rootPath: string
): PlannedFile[] {
  const items = repos.listKnowledge({ projectId, status: "approved" });
  const files: PlannedFile[] = [];

  files.push(planOne(rootPath, "AGENTS.md", renderAgentsMd(items)));

  const ghDir = ".github";
  files.push(
    planOne(
      rootPath,
      join(ghDir, "copilot-instructions.md"),
      renderInstructionMd(items, "Copilot Instructions")
    )
  );
  files.push(
    planOne(
      rootPath,
      join(ghDir, "prompts", "review-feedback.prompt.md"),
      renderReviewFeedbackPrompt(items)
    )
  );
  files.push(
    planOne(
      rootPath,
      join(ghDir, "prompts", "check-conflicts.prompt.md"),
      renderCheckConflictsPrompt()
    )
  );
  files.push(
    planOne(
      rootPath,
      join(ghDir, "agents", "project-reviewer.agent.md"),
      renderProjectReviewerAgent(items)
    )
  );

  const byDir = new Map<string, KnowledgeItem[]>();
  for (const i of items) {
    const dirs = i.appliesTo ? splitPatterns(i.appliesTo) : ["general"];
    for (const d of dirs) {
      const arr = byDir.get(d) ?? [];
      arr.push(i);
      byDir.set(d, arr);
    }
  }
  for (const [dir, dirItems] of byDir) {
    const name = dir === "general" ? "general" : dir.replace(/[\\/]/g, "-");
    files.push(
      planOne(
        rootPath,
        join(ghDir, "instructions", `${name}.instructions.md`),
        renderInstructionMd(dirItems, `Instructions: ${dir}`)
      )
    );
  }

  // Skills: each approved architecture/skill item becomes a SKILL.md.
  const skillItems = items.filter(
    (i) => i.category === "architecture" || i.category === "skill"
  );
  for (const item of skillItems) {
    const slug = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    files.push(
      planOne(
        rootPath,
        join(ghDir, "skills", slug, "SKILL.md"),
        renderSkillMd(item)
      )
    );
  }

  return files;
}

export function applyExport(planned: PlannedFile[]): string[] {
  const written: string[] = [];
  for (const f of planned) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content, "utf8");
    written.push(f.path);
  }
  return written;
}

export function exportForProject(
  repos: Repositories,
  projectId: string,
  rootPath: string
): { path: string; content: string }[] {
  const planned = planExport(repos, projectId, rootPath);
  const written = applyExport(planned);
  return planned
    .filter((p) => written.includes(p.path))
    .map((p) => ({ path: p.path, content: p.content }));
}
