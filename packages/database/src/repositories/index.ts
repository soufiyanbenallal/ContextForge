import { DB } from "../db.js";
import {
  newId,
  nowIso,
  normalizePath,
  KnowledgeCategory,
  KnowledgeScope,
  KnowledgeStatus,
  FeedbackType,
  FeedbackClassification,
  CapabilityType,
  ProjectInfo,
  FeedbackRecord,
  KnowledgeItem,
  KnowledgeVersion,
  ConflictRecord,
  CapabilityRecord,
} from "@contextforge/shared";

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  git_remote: string | null;
  fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRow {
  id: string;
  project_id: string | null;
  scope: string;
  category: string;
  title: string;
  content: string;
  status: string;
  priority: number;
  confidence: number;
  source_type: string;
  source_id: string | null;
  applies_to: string | null;
  version: number;
  superseded_by: string | null;
  supersedes: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackRow {
  id: string;
  interaction_id: string | null;
  project_id: string;
  feedback_type: string;
  message: string;
  severity: string;
  classification: string | null;
  created_at: string;
}

export interface ConflictRow {
  id: string;
  project_id: string | null;
  left_item_id: string;
  right_item_id: string;
  conflict_type: string;
  explanation: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
}

export interface CapabilityRow {
  id: string;
  type: string;
  name: string;
  description: string | null;
  source: string | null;
  config: string | null;
  enabled: number;
  last_checked_at: string | null;
  task_patterns: string;
  conflicts_with: string;
  required_config: string;
  projects: string;
  success_rate: number | null;
}

export interface VersionRow {
  id: string;
  knowledge_item_id: string;
  version: number;
  scope: string;
  category: string;
  title: string;
  content: string;
  status: string;
  priority: number;
  confidence: number;
  applies_to: string | null;
  reason: string | null;
  created_at: string;
}

function toVersion(r: VersionRow): KnowledgeVersion {
  return {
    id: r.id,
    knowledgeItemId: r.knowledge_item_id,
    version: r.version,
    scope: r.scope as KnowledgeVersion["scope"],
    category: r.category as KnowledgeVersion["category"],
    title: r.title,
    content: r.content,
    status: r.status as KnowledgeVersion["status"],
    priority: r.priority,
    confidence: r.confidence,
    appliesTo: r.applies_to,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

function toProject(r: ProjectRow): ProjectInfo {
  return {
    id: r.id,
    name: r.name,
    rootPath: r.root_path,
    gitRemote: r.git_remote,
    fingerprint: r.fingerprint,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toKnowledge(r: KnowledgeRow): KnowledgeItem {
  return {
    id: r.id,
    projectId: r.project_id,
    scope: r.scope as KnowledgeScope,
    category: r.category as KnowledgeCategory,
    title: r.title,
    content: r.content,
    status: r.status as KnowledgeStatus,
    priority: r.priority,
    confidence: r.confidence,
    sourceType: r.source_type,
    sourceId: r.source_id,
    appliesTo: r.applies_to,
    version: r.version,
    supersededBy: r.superseded_by,
    supersedes: r.supersedes,
    rejectedReason: r.rejected_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toFeedback(r: FeedbackRow): FeedbackRecord {
  return {
    id: r.id,
    interactionId: r.interaction_id,
    projectId: r.project_id,
    feedbackType: r.feedback_type as FeedbackType,
    message: r.message,
    severity: r.severity as FeedbackRecord["severity"],
    classification: (r.classification as FeedbackClassification) ?? null,
    createdAt: r.created_at,
  };
}

function toConflict(r: ConflictRow): ConflictRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    leftItemId: r.left_item_id,
    rightItemId: r.right_item_id,
    conflictType: r.conflict_type as ConflictRecord["conflictType"],
    explanation: r.explanation,
    status: r.status as ConflictRecord["status"],
    resolution: r.resolution,
    createdAt: r.created_at,
  };
}

function toCapability(r: CapabilityRow): CapabilityRecord {
  return {
    id: r.id,
    type: r.type as CapabilityType,
    name: r.name,
    description: r.description,
    source: r.source,
    config: r.config,
    enabled: r.enabled === 1,
    lastCheckedAt: r.last_checked_at,
    taskPatterns: JSON.parse(r.task_patterns) as string[],
    conflictsWith: JSON.parse(r.conflicts_with) as string[],
    requiredConfig: JSON.parse(r.required_config) as Record<string, unknown>,
    projects: JSON.parse(r.projects) as string[],
    successRate: r.success_rate,
  };
}

export class Repositories {
  constructor(private db: DB) {}

  getDatabase(): DB {
    return this.db;
  }

  // ---- projects ----
  upsertProject(input: {
    name: string;
    rootPath: string;
    gitRemote?: string | null;
    fingerprint?: string | null;
  }): ProjectInfo {
    const rootPath = normalizePath(input.rootPath);
    const existing = this.getProjectByPath(rootPath);
    const ts = nowIso();
    if (existing) {
      this.db
        .prepare(
          "UPDATE projects SET name=?, git_remote=?, fingerprint=?, updated_at=? WHERE id=?"
        )
        .run(
          input.name,
          input.gitRemote ?? existing.gitRemote,
          input.fingerprint ?? existing.fingerprint,
          ts,
          existing.id
        );
      return this.getProject(existing.id)!;
    }
    const id = newId("proj");
    this.db
      .prepare(
        "INSERT INTO projects (id, name, root_path, git_remote, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.name,
        rootPath,
        input.gitRemote ?? null,
        input.fingerprint ?? null,
        ts,
        ts
      );
    return this.getProject(id)!;
  }

  getProjectByPath(rootPath: string): ProjectInfo | null {
    const r = this.db
      .prepare("SELECT * FROM projects WHERE root_path=?")
      .get(normalizePath(rootPath)) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  getProject(id: string): ProjectInfo | null {
    const r = this.db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(id) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  listProjects(): ProjectInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[];
    return rows.map(toProject);
  }

  // ---- sessions / interactions ----
  createSession(input: {
    projectId: string;
    agent?: string | null;
    model?: string | null;
    task?: string | null;
  }): string {
    const id = newId("sess");
    this.db
      .prepare(
        "INSERT INTO sessions (id, project_id, agent, model, task, started_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.projectId,
        input.agent ?? null,
        input.model ?? null,
        input.task ?? null,
        nowIso()
      );
    return id;
  }

  createInteraction(input: {
    sessionId: string;
    prompt: string;
    response?: string | null;
    status?: string;
  }): string {
    const id = newId("intr");
    this.db
      .prepare(
        "INSERT INTO interactions (id, session_id, prompt, response, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.sessionId,
        input.prompt,
        input.response ?? null,
        input.status ?? "pending",
        nowIso()
      );
    return id;
  }

  // ---- feedback ----
  recordFeedback(input: {
    projectId: string;
    interactionId?: string | null;
    feedbackType: FeedbackType;
    message: string;
    severity?: FeedbackRecord["severity"];
    classification?: FeedbackClassification | null;
  }): FeedbackRecord {
    const id = newId("fb");
    this.db
      .prepare(
        "INSERT INTO feedback (id, interaction_id, project_id, feedback_type, message, severity, classification, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.interactionId ?? null,
        input.projectId,
        input.feedbackType,
        input.message,
        input.severity ?? "normal",
        input.classification ?? null,
        nowIso()
      );
    return this.getFeedback(id)!;
  }

  getFeedback(id: string): FeedbackRecord | null {
    const r = this.db
      .prepare("SELECT * FROM feedback WHERE id=?")
      .get(id) as FeedbackRow | undefined;
    return r ? toFeedback(r) : null;
  }

  listFeedback(projectId: string, limit = 100): FeedbackRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM feedback WHERE project_id=? ORDER BY created_at DESC LIMIT ?"
      )
      .all(projectId, limit) as FeedbackRow[];
    return rows.map(toFeedback);
  }

  // ---- knowledge items ----
  createKnowledge(input: {
    projectId?: string | null;
    scope: KnowledgeScope;
    category: KnowledgeCategory;
    title: string;
    content: string;
    status?: KnowledgeStatus;
    priority?: number;
    confidence?: number;
    sourceType: string;
    sourceId?: string | null;
    appliesTo?: string | null;
  }): KnowledgeItem {
    const id = newId("kn");
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO knowledge_items
         (id, project_id, scope, category, title, content, status, priority, confidence, source_type, source_id, applies_to, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        id,
        input.projectId ?? null,
        input.scope,
        input.category,
        input.title,
        input.content,
        input.status ?? "proposed",
        input.priority ?? 50,
        input.confidence ?? 0.5,
        input.sourceType,
        input.sourceId ?? null,
        input.appliesTo ?? null,
        ts,
        ts
      );
    this.snapshotVersion(id, input.status ?? "proposed", null);
    this.syncFts(id);
    return this.getKnowledge(id)!;
  }

  getKnowledge(id: string): KnowledgeItem | null {
    const r = this.db
      .prepare("SELECT * FROM knowledge_items WHERE id=?")
      .get(id) as KnowledgeRow | undefined;
    return r ? toKnowledge(r) : null;
  }

  private snapshotVersion(
    knowledgeItemId: string,
    status: KnowledgeStatus,
    reason: string | null
  ): void {
    const item = this.getKnowledge(knowledgeItemId);
    if (!item) return;
    this.db
      .prepare(
        `INSERT INTO knowledge_versions
         (id, knowledge_item_id, version, scope, category, title, content, status, priority, confidence, applies_to, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId("ver"),
        knowledgeItemId,
        item.version,
        item.scope,
        item.category,
        item.title,
        item.content,
        status,
        item.priority,
        item.confidence,
        item.appliesTo,
        reason,
        nowIso()
      );
  }

  listVersions(knowledgeItemId: string): KnowledgeVersion[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM knowledge_versions WHERE knowledge_item_id=? ORDER BY version ASC"
      )
      .all(knowledgeItemId) as VersionRow[];
    return rows.map(toVersion);
  }

  updateKnowledgeStatus(
    id: string,
    status: KnowledgeStatus,
    options: { reason?: string | null; snapshot?: boolean } = {}
  ): KnowledgeItem | null {
    const existing = this.getKnowledge(id);
    if (!existing) return null;
    const ts = nowIso();
    const stmt = options.reason !== undefined
      ? "UPDATE knowledge_items SET status=?, version=?, rejected_reason=?, updated_at=? WHERE id=?"
      : "UPDATE knowledge_items SET status=?, version=?, updated_at=? WHERE id=?";
    const params =
      options.reason !== undefined
        ? [status, existing.version, options.reason, ts, id]
        : [status, existing.version, ts, id];
    this.db.prepare(stmt).run(...(params as unknown[]));
    if (options.snapshot !== false) {
      this.snapshotVersion(id, status, options.reason ?? null);
    }
    this.syncFts(id);
    return this.getKnowledge(id);
  }

  /** Edit a rule's text/scope in place (snapshotting a new version). */
  editKnowledge(
    id: string,
    patch: {
      title?: string;
      content?: string;
      appliesTo?: string | null;
      priority?: number;
      category?: KnowledgeCategory;
    },
    reason: string | null = "Edited"
  ): KnowledgeItem | null {
    const item = this.getKnowledge(id);
    if (!item) return null;
    this.db
      .prepare(
        "UPDATE knowledge_items SET title=?, content=?, applies_to=?, priority=?, category=?, version=version+1, updated_at=? WHERE id=?"
      )
      .run(
        patch.title ?? item.title,
        patch.content ?? item.content,
        patch.appliesTo === undefined ? item.appliesTo : patch.appliesTo,
        patch.priority ?? item.priority,
        patch.category ?? item.category,
        nowIso(),
        id
      );
    this.snapshotVersion(id, item.status, reason);
    this.syncFts(id);
    return this.getKnowledge(id);
  }

  /**
   * Reinforcement signal for the learning loop.
   * - outcome "prevented": an approved lesson successfully stopped a repeat
   *   fault -> confidence and priority rise (capped).
   * - outcome "miss": a lesson was available but not matched -> slight decay.
   * Returns the updated item (or null if not found).
   */
  recordKnowledgeHit(
    id: string,
    outcome: "prevented" | "miss"
  ): KnowledgeItem | null {
    const item = this.getKnowledge(id);
    if (!item) return null;
    const ts = nowIso();
    let confidence = item.confidence;
    let priority = item.priority;
    if (outcome === "prevented") {
      confidence = Math.min(1, confidence + 0.15);
      priority = Math.min(100, priority + 4);
    } else {
      confidence = Math.max(0.05, confidence - 0.05);
      priority = Math.max(10, priority - 1);
    }
    this.db
      .prepare(
        "UPDATE knowledge_items SET confidence=?, priority=?, version=version+1, updated_at=? WHERE id=?"
      )
      .run(confidence, priority, ts, id);
    this.syncFts(id);
    return this.getKnowledge(id);
  }

  supersedeKnowledge(
    oldId: string,
    newId: string,
    resolution?: string | null
  ): { old: KnowledgeItem; next: KnowledgeItem } | null {
    const oldItem = this.getKnowledge(oldId);
    const newItem = this.getKnowledge(newId);
    if (!oldItem || !newItem) return null;
    const ts = nowIso();
    this.db
      .prepare(
        "UPDATE knowledge_items SET status='superseded', superseded_by=?, version=version+1, updated_at=? WHERE id=?"
      )
      .run(newId, ts, oldId);
    this.db
      .prepare(
        "UPDATE knowledge_items SET supersedes=? WHERE id=?"
      )
      .run(oldId, newId);
    this.snapshotVersion(oldId, "superseded", resolution ?? "Superseded by newer rule");
    return { old: this.getKnowledge(oldId)!, next: this.getKnowledge(newId)! };
  }

  resolveConflict(
    conflictId: string,
    resolution: string,
    supersedeLeftId?: string | null,
    supersedeRightId?: string | null
  ): ConflictRecord | null {
    const conflict = this.getConflict(conflictId);
    if (!conflict) return null;
    this.db
      .prepare(
        "UPDATE conflicts SET status='resolved', resolution=? WHERE id=?"
      )
      .run(resolution, conflictId);
    if (supersedeLeftId) {
      this.updateKnowledgeStatus(supersedeLeftId, "superseded", {
        reason: `Resolved conflict ${conflictId}`,
      });
    }
    if (supersedeRightId) {
      this.updateKnowledgeStatus(supersedeRightId, "superseded", {
        reason: `Resolved conflict ${conflictId}`,
      });
    }
    return this.getConflict(conflictId);
  }

  listKnowledge(
    filters: {
      projectId?: string | null;
      status?: KnowledgeStatus;
      scope?: KnowledgeScope;
      category?: KnowledgeCategory;
    } = {}
  ): KnowledgeItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.projectId !== undefined) {
      where.push("project_id=?");
      params.push(filters.projectId);
    }
    if (filters.status) {
      where.push("status=?");
      params.push(filters.status);
    }
    if (filters.scope) {
      where.push("scope=?");
      params.push(filters.scope);
    }
    if (filters.category) {
      where.push("category=?");
      params.push(filters.category);
    }
    const sql = `SELECT * FROM knowledge_items${
      where.length ? " WHERE " + where.join(" AND ") : ""
    } ORDER BY priority DESC, updated_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as KnowledgeRow[];
    return rows.map(toKnowledge);
  }

  addAppliesToKnowledge(id: string, value: string | null): void {
    this.db
      .prepare("UPDATE knowledge_items SET applies_to=?, updated_at=? WHERE id=?")
      .run(value, nowIso(), id);
    this.syncFts(id);
  }

  conflictsForItem(itemId: string): ConflictRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM conflicts WHERE (left_item_id=? OR right_item_id=?) AND status='open'"
      )
      .all(itemId, itemId) as ConflictRow[];
    return rows.map(toConflict);
  }

  private syncFts(id: string): void {
    const r = this.db
      .prepare(
        "SELECT knowledge_item_id FROM knowledge_search WHERE knowledge_item_id=?"
      )
      .get(id) as { knowledge_item_id: string } | undefined;
    const item = this.getKnowledge(id);
    if (!item) return;
    if (r) {
      this.db
        .prepare("DELETE FROM knowledge_search WHERE knowledge_item_id=?")
        .run(id);
    }
    this.db
      .prepare(
        "INSERT INTO knowledge_search (knowledge_item_id, title, content, category, applies_to) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, item.title, item.content, item.category, item.appliesTo ?? "");
  }

  searchKnowledge(
    query: string,
    projectId?: string | null,
    limit = 20
  ): KnowledgeItem[] {
    const terms = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `%${t.replace(/[%_]/g, "\\$&")}%`);
    if (terms.length === 0) return [];
    const likeExpr = terms.map(() => "(s.title LIKE ? ESCAPE '\\' OR s.content LIKE ? ESCAPE '\\' OR s.category LIKE ? ESCAPE '\\')").join(" AND ");
    const params: unknown[] = [];
    for (const t of terms) {
      params.push(t, t, t);
    }
    const rows = this.db
      .prepare(
        `SELECT k.* FROM knowledge_search s
         JOIN knowledge_items k ON k.id = s.knowledge_item_id
         WHERE ${likeExpr}
         LIMIT ?`
      )
      .all(...params, limit) as KnowledgeRow[];
    let items = rows.map(toKnowledge);
    if (projectId !== undefined) {
      items = items.filter(
        (i) => i.projectId === projectId || i.projectId === null
      );
    }
    return items;
  }

  // ---- conflicts ----
  createConflict(input: {
    projectId?: string | null;
    leftItemId: string;
    rightItemId: string;
    conflictType: ConflictRecord["conflictType"];
    explanation?: string | null;
  }): ConflictRecord {
    // Re-running conflict detection must not pile up duplicates: return the
    // existing open conflict for the same pair of rules (either order).
    const existing = this.db
      .prepare(
        "SELECT id FROM conflicts WHERE status='open' AND ((left_item_id=? AND right_item_id=?) OR (left_item_id=? AND right_item_id=?)) LIMIT 1"
      )
      .get(input.leftItemId, input.rightItemId, input.rightItemId, input.leftItemId) as
      | { id: string }
      | undefined;
    if (existing) return this.getConflict(existing.id)!;
    const id = newId("cnf");
    this.db
      .prepare(
        "INSERT INTO conflicts (id, project_id, left_item_id, right_item_id, conflict_type, explanation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)"
      )
      .run(
        id,
        input.projectId ?? null,
        input.leftItemId,
        input.rightItemId,
        input.conflictType,
        input.explanation ?? null,
        nowIso()
      );
    return this.getConflict(id)!;
  }

  getConflict(id: string): ConflictRecord | null {
    const r = this.db
      .prepare("SELECT * FROM conflicts WHERE id=?")
      .get(id) as ConflictRow | undefined;
    return r ? toConflict(r) : null;
  }

  listConflicts(
    projectId?: string | null,
    status?: "open" | "resolved"
  ): ConflictRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (projectId !== undefined) {
      where.push("project_id=?");
      params.push(projectId);
    }
    if (status) {
      where.push("status=?");
      params.push(status);
    }
    const sql = `SELECT * FROM conflicts${
      where.length ? " WHERE " + where.join(" AND ") : ""
    } ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as ConflictRow[];
    return rows.map(toConflict);
  }

  // ---- capabilities ----
  upsertCapability(input: {
    type: CapabilityType;
    name: string;
    description?: string | null;
    source?: string | null;
    config?: string | null;
    taskPatterns?: string[];
    conflictsWith?: string[];
    requiredConfig?: Record<string, unknown>;
    projects?: string[];
  }): CapabilityRecord {
    const existing = this.getCapabilityByName(input.name);
    if (existing) {
      this.db
        .prepare(
          "UPDATE capabilities SET type=?, description=?, source=?, config=?, task_patterns=?, conflicts_with=?, required_config=?, projects=? WHERE id=?"
        )
        .run(
          input.type,
          input.description ?? existing.description,
          input.source ?? existing.source,
          input.config ?? existing.config,
          JSON.stringify(input.taskPatterns ?? existing.taskPatterns),
          JSON.stringify(input.conflictsWith ?? existing.conflictsWith),
          JSON.stringify(input.requiredConfig ?? existing.requiredConfig),
          JSON.stringify(input.projects ?? existing.projects),
          existing.id
        );
      return this.getCapability(existing.id)!;
    }
    const id = newId("cap");
    this.db
      .prepare(
        "INSERT INTO capabilities (id, type, name, description, source, config, enabled, task_patterns, conflicts_with, required_config, projects, success_rate) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)"
      )
      .run(
        id,
        input.type,
        input.name,
        input.description ?? null,
        input.source ?? null,
        input.config ?? null,
        JSON.stringify(input.taskPatterns ?? []),
        JSON.stringify(input.conflictsWith ?? []),
        JSON.stringify(input.requiredConfig ?? {}),
        JSON.stringify(input.projects ?? [])
      );
    return this.getCapability(id)!;
  }

  getCapability(id: string): CapabilityRecord | null {
    const r = this.db
      .prepare("SELECT * FROM capabilities WHERE id=?")
      .get(id) as CapabilityRow | undefined;
    return r ? toCapability(r) : null;
  }

  getCapabilityByName(name: string): CapabilityRecord | null {
    const r = this.db
      .prepare("SELECT * FROM capabilities WHERE name=?")
      .get(name) as CapabilityRow | undefined;
    return r ? toCapability(r) : null;
  }

  listCapabilities(enabledOnly = false): CapabilityRecord[] {
    const sql = enabledOnly
      ? "SELECT * FROM capabilities WHERE enabled=1 ORDER BY name"
      : "SELECT * FROM capabilities ORDER BY name";
    const rows = this.db.prepare(sql).all() as CapabilityRow[];
    return rows.map(toCapability);
  }

  recordUsage(input: {
    capabilityId: string;
    projectId?: string | null;
    taskType?: string | null;
    outcome?: string | null;
    score?: number | null;
  }): void {
    this.db
      .prepare(
        "INSERT INTO capability_usage (id, capability_id, project_id, task_type, outcome, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        newId("use"),
        input.capabilityId,
        input.projectId ?? null,
        input.taskType ?? null,
        input.outcome ?? null,
        input.score ?? null,
        nowIso()
      );
    this.recomputeSuccessRate(input.capabilityId);
  }

  private recomputeSuccessRate(capabilityId: string): void {
    const row = this.db
      .prepare(
        "SELECT AVG(score) AS avg FROM capability_usage WHERE capability_id=? AND score IS NOT NULL"
      )
      .get(capabilityId) as { avg: number | null };
    if (row?.avg !== null && row?.avg !== undefined) {
      this.db
        .prepare("UPDATE capabilities SET success_rate=? WHERE id=?")
        .run(row.avg, capabilityId);
    }
  }

  setCapabilityEnabled(id: string, enabled: boolean): CapabilityRecord | null {
    this.db
      .prepare("UPDATE capabilities SET enabled=? WHERE id=?")
      .run(enabled ? 1 : 0, id);
    return this.getCapability(id);
  }

  setCapabilityConfig(id: string, config: string | null): CapabilityRecord | null {
    this.db
      .prepare("UPDATE capabilities SET config=? WHERE id=?")
      .run(config, id);
    return this.getCapability(id);
  }

  setCapabilityProjects(id: string, projects: string[]): CapabilityRecord | null {
    this.db
      .prepare("UPDATE capabilities SET projects=? WHERE id=?")
      .run(JSON.stringify(projects), id);
    return this.getCapability(id);
  }

  validateCapabilityConfig(id: string): { valid: boolean; missing: string[] } {
    const cap = this.getCapability(id);
    if (!cap) return { valid: false, missing: [] };
    const required = Object.keys(cap.requiredConfig ?? {});
    if (required.length === 0) return { valid: true, missing: [] };
    let parsed: Record<string, unknown> = {};
    if (cap.config) {
      try {
        parsed = JSON.parse(cap.config);
      } catch {
        return { valid: false, missing: required };
      }
    }
    const missing = required.filter((k) => !(k in parsed));
    return { valid: missing.length === 0, missing };
  }
}
