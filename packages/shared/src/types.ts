import { z } from "zod";

export const KnowledgeCategorySchema = z.enum([
  "architecture",
  "coding-rule",
  "user-preference",
  "failed-approach",
  "accepted-pattern",
  "project-decision",
  "dependency-guide",
  "security-rule",
  "workflow",
  "skill",
  "mcp",
]);
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const KnowledgeScopeSchema = z.enum([
  "global",
  "workspace",
  "project",
  "directory",
  "language",
  "task",
]);
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;

export const KnowledgeStatusSchema = z.enum([
  "proposed",
  "approved",
  "superseded",
  "rejected",
]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export const FeedbackTypeSchema = z.enum([
  "accept",
  "reject",
  "correction",
  "fault",
]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackClassificationSchema = z.enum([
  "incorrect-code",
  "violated-architecture",
  "ignored-request",
  "outdated-api",
  "unnecessary-complexity",
  "wrong-tool",
  "other",
]);
export type FeedbackClassification = z.infer<typeof FeedbackClassificationSchema>;

export const ConflictTypeSchema = z.enum([
  "direct",
  "semantic",
  "precedence",
]);
export type ConflictType = z.infer<typeof ConflictTypeSchema>;

export const CapabilityTypeSchema = z.enum(["skill", "mcp"]);
export type CapabilityType = z.infer<typeof CapabilityTypeSchema>;

export const KnowledgeItemSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  scope: KnowledgeScopeSchema,
  category: KnowledgeCategorySchema,
  title: z.string(),
  content: z.string(),
  status: KnowledgeStatusSchema,
  priority: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  appliesTo: z.string().nullable(),
  version: z.number().int().positive(),
  supersededBy: z.string().nullable(),
  supersedes: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

export const KnowledgeVersionSchema = z.object({
  id: z.string(),
  knowledgeItemId: z.string(),
  version: z.number().int().positive(),
  scope: KnowledgeScopeSchema,
  category: KnowledgeCategorySchema,
  title: z.string(),
  content: z.string(),
  status: KnowledgeStatusSchema,
  priority: z.number().int(),
  confidence: z.number(),
  appliesTo: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type KnowledgeVersion = z.infer<typeof KnowledgeVersionSchema>;

export const FeedbackRecordSchema = z.object({
  id: z.string(),
  interactionId: z.string().nullable(),
  projectId: z.string(),
  feedbackType: FeedbackTypeSchema,
  message: z.string(),
  severity: z.enum(["low", "normal", "high", "critical"]),
  classification: FeedbackClassificationSchema.nullable(),
  createdAt: z.string(),
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  gitRemote: string | null;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictRecord {
  id: string;
  projectId: string | null;
  leftItemId: string;
  rightItemId: string;
  conflictType: ConflictType;
  explanation: string | null;
  status: "open" | "resolved";
  resolution: string | null;
  createdAt: string;
}

export interface CapabilityRecord {
  id: string;
  type: CapabilityType;
  name: string;
  description: string | null;
  source: string | null;
  config: string | null;
  enabled: boolean;
  lastCheckedAt: string | null;
  taskPatterns: string[];
  conflictsWith: string[];
  requiredConfig: Record<string, unknown>;
  projects: string[];
  successRate: number | null;
}
