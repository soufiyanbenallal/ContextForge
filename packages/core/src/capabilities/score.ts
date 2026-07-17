import { Repositories } from "@contextforge/database";
import { CapabilityRecord } from "@contextforge/shared";

export interface CapabilityRecommendation {
  capability: CapabilityRecord;
  score: number;
  reasons: string[];
}

function keywordMatch(query: string, patterns: string[]): number {
  const q = query.toLowerCase();
  let hits = 0;
  for (const p of patterns) {
    if (q.includes(p.toLowerCase())) hits += 1;
  }
  return hits;
}

export function scoreCapabilities(
  repos: Repositories,
  input: { task?: string; projectId?: string | null; files?: string[] }
): CapabilityRecommendation[] {
  const caps = repos.listCapabilities(true);
  const recs: CapabilityRecommendation[] = [];

  for (const cap of caps) {
    const reasons: string[] = [];
    let score = 0;

    if (input.task) {
      const km = keywordMatch(input.task, cap.taskPatterns);
      if (km > 0) {
        score += km * 30;
        reasons.push(`matches task keywords (${km})`);
      }
    }

    if (
      input.projectId &&
      cap.projects.length &&
      cap.projects.includes(input.projectId)
    ) {
      score += 20;
      reasons.push("associated with this project");
    }

    if (cap.successRate !== null) {
      score += Math.round(cap.successRate * 20);
      reasons.push(`track record ${(cap.successRate * 100).toFixed(0)}%`);
    }

    for (const other of cap.conflictsWith) {
      if (caps.some((c) => c.name === other && c.enabled)) {
        score -= 25;
        reasons.push(`conflicts with enabled ${other}`);
      }
    }

    if (score > 0) recs.push({ capability: cap, score, reasons });
  }

  return recs.sort((a, b) => b.score - a.score);
}

export interface CapabilityReport {
  recommended: CapabilityRecommendation[];
  disableTemporarily: { capability: CapabilityRecord; reason: string }[];
  configIssues: { capability: CapabilityRecord; missing: string[] }[];
}

export function recommendCapabilities(
  repos: Repositories,
  input: { task?: string; projectId?: string | null; files?: string[] }
): CapabilityReport {
  const caps = repos.listCapabilities(true);
  const recommended = scoreCapabilities(repos, input);

  const disableTemporarily: { capability: CapabilityRecord; reason: string }[] = [];
  for (const cap of caps) {
    for (const other of cap.conflictsWith) {
      const conflict = caps.find((c) => c.name === other && c.enabled);
      if (conflict) {
        disableTemporarily.push({
          capability: cap,
          reason: `conflicts with enabled "${other}"`,
        });
        break;
      }
    }
  }

  const configIssues: { capability: CapabilityRecord; missing: string[] }[] = [];
  for (const cap of repos.listCapabilities()) {
    const v = repos.validateCapabilityConfig(cap.id);
    if (!v.valid) {
      configIssues.push({ capability: cap, missing: v.missing });
    }
  }

  return { recommended, disableTemporarily, configIssues };
}
