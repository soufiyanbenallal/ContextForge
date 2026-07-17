import { z } from "zod";
import { ServerContext, resolveProject } from "../context.js";
import {
  getContext,
  detectConflicts,
  proposeLessonFromFeedback,
  captureFault,
  autoLearn,
  supersedeRule,
  recommendCapabilities,
  syncCapabilities,
  validateAllCapabilities,
  checkConflictsDeep,
} from "@contextforge/core";
import { planExport, applyExport } from "@contextforge/exporters";
import { KnowledgeStatus, FeedbackType } from "@contextforge/shared";

export const toolSchemas = {
  memory_get_context: {
    projectPath: z.string().optional(),
    task: z.string().optional(),
    files: z.array(z.string()).optional(),
    maxItems: z.number().optional(),
  },
  memory_record_feedback: {
    projectPath: z.string().optional(),
    feedbackType: z.enum(["accept", "reject", "correction"]),
    message: z.string(),
    severity: z.enum(["low", "normal", "high", "critical"]).optional(),
    classification: z
      .enum([
        "incorrect-code",
        "violated-architecture",
        "ignored-request",
        "outdated-api",
        "unnecessary-complexity",
        "wrong-tool",
        "other",
      ])
      .optional(),
    interactionId: z.string().optional(),
  },
  memory_search: {
    projectPath: z.string().optional(),
    query: z.string(),
    limit: z.number().optional(),
  },
  memory_find_conflicts: {
    projectPath: z.string().optional(),
  },
  memory_propose_lesson: {
    feedbackId: z.string(),
    scopeLabel: z.enum(["task", "project", "all"]).optional(),
    categoryOverride: z.string().optional(),
    appliesTo: z.string().optional(),
  },
  memory_record_fault: {
    projectPath: z.string().optional(),
    kind: z
      .enum(["build", "test", "lint", "typecheck", "runtime", "rejected-edit", "other"])
      .optional(),
    message: z.string(),
    detail: z.string().optional(),
    source: z.string().optional(),
    appliesTo: z.string().optional(),
  },
  memory_auto_learn: {
    feedbackId: z.string(),
    scopeLabel: z.enum(["task", "project", "all"]).optional(),
    appliesTo: z.string().optional(),
  },
  memory_reinforce_lesson: {
    knowledgeId: z.string(),
    outcome: z.enum(["prevented", "miss"]).optional(),
  },
  memory_approve_lesson: {
    knowledgeId: z.string(),
  },
  memory_reject_lesson: {
    knowledgeId: z.string(),
    reason: z.string().optional(),
  },
  memory_supersede_rule: {
    oldKnowledgeId: z.string(),
    newKnowledgeId: z.string(),
    resolution: z.string().optional(),
  },
  memory_resolve_conflict: {
    conflictId: z.string(),
    resolution: z.string(),
    supersedeLeftId: z.string().optional(),
    supersedeRightId: z.string().optional(),
  },
  memory_lesson_history: {
    knowledgeId: z.string(),
  },
  memory_list_project_rules: {
    projectPath: z.string().optional(),
    status: z.enum(["proposed", "approved", "superseded", "rejected"]).optional(),
  },
  memory_recommend_capabilities: {
    projectPath: z.string().optional(),
    task: z.string().optional(),
    files: z.array(z.string()).optional(),
  },
  memory_sync_capabilities: {
    projectPath: z.string().optional(),
  },
  memory_set_capability_enabled: {
    capabilityId: z.string(),
    enabled: z.boolean(),
  },
  memory_record_capability_usage: {
    capabilityId: z.string(),
    outcome: z.enum(["success", "failure", "partial"]),
    score: z.number().optional(),
    taskType: z.string().optional(),
  },
  memory_validate_capabilities: {
    projectPath: z.string().optional(),
  },
  memory_export_instructions: {
    projectPath: z.string().optional(),
    apply: z.boolean().optional(),
  },
  memory_deep_conflict_check: {
    projectPath: z.string().optional(),
  },
} as const;

export async function handleTool(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[] }> {
  switch (name) {
    case "memory_get_context": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const result = getContext(ctx.repos, {
        projectId,
        task: args.task as string | undefined,
        files: args.files as string[] | undefined,
        maxItems: args.maxItems as number | undefined,
      });
      return text(result);
    }
    case "memory_record_feedback": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const rec = ctx.repos.recordFeedback({
        projectId,
        feedbackType: args.feedbackType as FeedbackType,
        message: args.message as string,
        severity: args.severity as never,
        classification: (args.classification as never) ?? null,
        interactionId: (args.interactionId as string) ?? null,
      });
      return text(rec);
    }
    case "memory_search": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const items = ctx.repos.searchKnowledge(
        args.query as string,
        projectId,
        (args.limit as number) ?? 20
      );
      return text(items);
    }
    case "memory_find_conflicts": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const detected = detectConflicts(ctx.repos, projectId);
      const created = detected.map((d) =>
        ctx.repos.createConflict({
          projectId,
          leftItemId: d.leftItemId,
          rightItemId: d.rightItemId,
          conflictType: d.conflictType,
          explanation: d.explanation,
        })
      );
      return text({ detected: detected.length, conflicts: created });
    }
    case "memory_propose_lesson": {
      const result = proposeLessonFromFeedback(
        ctx.repos,
        args.feedbackId as string,
        {
          scopeLabel: args.scopeLabel as never,
          categoryOverride: args.categoryOverride as never,
          appliesTo: (args.appliesTo as string) ?? null,
        }
      );
      return text(result);
    }
    case "memory_record_fault": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const result = captureFault(ctx.repos, {
        projectId,
        kind: (args.kind as never) ?? "other",
        message: args.message as string,
        detail: (args.detail as string) ?? undefined,
        source: (args.source as string) ?? null,
        appliesTo: (args.appliesTo as string) ?? null,
      });
      return text(result);
    }
    case "memory_auto_learn": {
      const result = autoLearn(ctx.repos, args.feedbackId as string, {
        scopeLabel: args.scopeLabel as never,
        appliesTo: (args.appliesTo as string) ?? null,
      });
      return text(result);
    }
    case "memory_reinforce_lesson": {
      const id = args.knowledgeId as string;
      const outcome = (args.outcome as "prevented" | "miss") ?? "prevented";
      const item = ctx.repos.recordKnowledgeHit(id, outcome);
      return text(item);
    }
    case "memory_approve_lesson": {
      const item = ctx.repos.updateKnowledgeStatus(
        args.knowledgeId as string,
        "approved" as KnowledgeStatus
      );
      return text(item);
    }
    case "memory_reject_lesson": {
      const item = ctx.repos.updateKnowledgeStatus(
        args.knowledgeId as string,
        "rejected" as KnowledgeStatus,
        { reason: (args.reason as string) ?? null }
      );
      return text(item);
    }
    case "memory_list_project_rules": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const items = ctx.repos.listKnowledge({
        projectId,
        status: args.status as KnowledgeStatus | undefined,
      });
      return text(items);
    }
    case "memory_supersede_rule": {
      const result = supersedeRule(
        ctx.repos,
        args.oldKnowledgeId as string,
        args.newKnowledgeId as string,
        (args.resolution as string) ?? null
      );
      return text(result);
    }
    case "memory_resolve_conflict": {
      const conflict = ctx.repos.resolveConflict(
        args.conflictId as string,
        args.resolution as string,
        (args.supersedeLeftId as string) ?? null,
        (args.supersedeRightId as string) ?? null
      );
      return text(conflict);
    }
    case "memory_lesson_history": {
      const versions = ctx.repos.listVersions(args.knowledgeId as string);
      return text(versions);
    }
    case "memory_recommend_capabilities": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const report = recommendCapabilities(ctx.repos, {
        task: args.task as string | undefined,
        projectId,
        files: args.files as string[] | undefined,
      });
      return text(report);
    }
    case "memory_sync_capabilities": {
      const { projectId, rootPath } = resolveProject(
        ctx,
        args.projectPath as string
      );
      const result = syncCapabilities(ctx.repos, rootPath, projectId);
      return text(result);
    }
    case "memory_set_capability_enabled": {
      const cap = ctx.repos.setCapabilityEnabled(
        args.capabilityId as string,
        args.enabled === true
      );
      return text(cap);
    }
    case "memory_record_capability_usage": {
      ctx.repos.recordUsage({
        capabilityId: args.capabilityId as string,
        outcome: args.outcome as string,
        score:
          args.score === undefined
            ? args.outcome === "success"
              ? 1
              : args.outcome === "failure"
                ? 0
                : 0.5
            : (args.score as number),
        taskType: (args.taskType as string) ?? null,
      });
      const cap = ctx.repos.getCapability(args.capabilityId as string);
      return text(cap);
    }
    case "memory_validate_capabilities": {
      const report = validateAllCapabilities(ctx.repos);
      return text(report);
    }
    case "memory_export_instructions": {
      const { projectId, rootPath } = resolveProject(
        ctx,
        args.projectPath as string
      );
      const planned = planExport(ctx.repos, projectId, rootPath);
      if (args.apply === true) {
        const written = applyExport(planned);
        return text({
          mode: "applied",
          written,
          changed: planned.filter((p) => p.diff).map((p) => p.path),
        });
      }
      return text({
        mode: "plan",
        note: "Review the diffs. Call with apply=true to write files.",
        files: planned.map((p) => ({
          path: p.path,
          exists: p.exists,
          hasChanges: p.diff !== null,
          diff: p.diff,
        })),
      });
    }
    case "memory_deep_conflict_check": {
      const { projectId } = resolveProject(ctx, args.projectPath as string);
      const result = await checkConflictsDeep(ctx.repos, projectId);
      const created = result.semantic
        .filter((s) => s.conflict)
        .map((s) =>
          ctx.repos.createConflict({
            projectId,
            leftItemId: s.leftItemId,
            rightItemId: s.rightItemId,
            conflictType: (s.type === "none" ? "semantic" : s.type) as "direct" | "semantic" | "precedence",
            explanation: s.explanation,
          })
        );
      return text({
        deterministic: result.deterministic,
        semantic: result.semantic,
        recorded: created,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function text(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}
