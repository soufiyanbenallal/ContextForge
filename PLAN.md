# Agent Memory — Implementation Plan

A local-first MCP server (SQLite) that turns agent feedback and failures into
approved, scoped project knowledge. VS Code extension is a thin dashboard.
See `app-description.md` for full spec.

## Guiding principles
- Learning is safe: feedback → proposed lesson → human approval → active rule. Never auto-rewrite.
- MCP core, portable to VS Code / Codex / Claude Code / Cursor.
- SQLite source of truth; exporters generate existing agent file formats only.
- No secrets/blobs stored; Workspace Trust respected; diffs shown before writes.

---

## Phase 1 — CLI + MCP core (MVP, highest value)

- [ ] Scaffold pnpm monorepo: `apps/cli`, `apps/vscode-extension`, `packages/{core,database,mcp-server,exporters,shared}`.
- [ ] `packages/database`: SQLite (better-sqlite3), migrations (projects, sessions, interactions, feedback, knowledge_items, conflicts, capabilities, capability_usage), FTS5 `knowledge_search`.
- [ ] `packages/database/repositories`: typed CRUD + FTS search helpers.
- [ ] `packages/core`: project detection (git root, fingerprint, remote), retrieval (`get_context`), deterministic conflict detection.
- [ ] `packages/mcp-server`: MCP SDK server (stdio) exposing:
  - [ ] `memory_get_context`
  - [ ] `memory_record_feedback`
  - [ ] `memory_search`
  - [ ] `memory_find_conflicts`
- [ ] `apps/cli`: `init`, `feedback`, `search`, `conflicts`, `export`, `serve`.
- [ ] `packages/exporters/agents-md` + `exporters/vscode`: export approved rules to `AGENTS.md` and `.github/instructions`.
- [ ] Vitest tests for schema, retrieval, conflict detection, exporters.
- [ ] Manual end-to-end: connect Claude Code / VS Code to MCP server, run a task, record reject, export.

## Phase 2 — Proposed lessons

- [x] `packages/core/lessons`: feedback → lesson extraction (structured proposal, not active).
- [x] Lesson lifecycle: proposed → approved → superseded → rejected, with `version` + `source_id` linkage to feedback.
- [x] `knowledge_versions` table snapshots every status change.
- [x] Conflict-aware proposal: proposing a lesson auto-detects conflicts vs approved rules.
- [x] Supersede flow: link old→new (`supersededBy`/`supersedes`), auto-resolve open conflicts.
- [x] MCP tools: `memory_propose_lesson`, `memory_approve_lesson`, `memory_reject_lesson`, `memory_supersede_rule`, `memory_resolve_conflict`, `memory_lesson_history`, `memory_list_project_rules`.
- [x] Scope/priority/confidence assignment + precedence model.
- [x] Tests: extraction, approval gating, supersede, version history, conflict-at-proposal, resolve.

## Phase 3 — VS Code extension (dashboard)

- [x] Extension scaffold (esbuild bundle); connects directly to SQLite + core (no separate logic).
- [x] Tree view: Approved rules / Proposed lessons / Conflicts / Skills & MCPs, inline approve/reject.
- [x] Commands: Accept, Reject, Record Correction, Save as Project Rule, Save as Global Preference, View Memory, Review Lessons, Check Conflicts, Show Rules for File, Export.
- [x] Reject form (reason + classification + scope).
- [x] Editor actions: save selection as rule, show rules for current file.
- [x] Diagnostics: conflicting instructions surfaced as warnings.
- [x] Workspace Trust gating before any scanning/export.
- [x] Tests: extension data glue (backend + tree).

## Phase 4 — Capability manager

- [x] `packages/core/capabilities`: registry for skills & MCPs (`taskPatterns`, `conflictsWith`, `requiredConfig`, per-project, `successRate`).
- [x] Discovery: scan `.github/skills/*/SKILL.md` and `.mcp.json`/`mcp.json`.
- [x] Task matching + deterministic scoring; track `capability_usage` outcomes → rolling `successRate`.
- [x] MCP tools: `memory_sync_capabilities`, `memory_set_capability_enabled`, `memory_record_capability_usage`, `memory_validate_capabilities`; `memory_recommend_capabilities` returns full report.
- [x] CLI: `cap-sync`, `cap-list`, `cap-enable`, `cap-disable`, `cap-validate`.
- [x] Extension tree surfaces "Capability config issues".
- [x] Tests: discovery, sync, config validation, recommendation, usage tracking.

## Phase 5 — Controlled synchronization

- [x] Exporters for: `AGENTS.md`, `copilot-instructions.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`.
- [x] `planExport` (diff) + `applyExport` (write); never write without explicit apply.
- [x] MCP `memory_export_instructions` returns a plan (files+diffs) by default; `apply:true` writes. CLI `export` plan-mode default + `--apply`.
- [x] Extension "Export Instructions" shows diff + confirms, gated on Workspace Trust.
- [x] `memory_deep_conflict_check` (CLI `conflicts --deep`): deterministic + pluggable semantic `ConflictModel`.
- [ ] Optional: embeddings for semantic retrieval (only if FTS5 proves weak at scale) — deferred.

## Definition of done (MVP)
1. Detect git repo. 2. Store project-scoped feedback. 3. Convert to proposed lessons. 4. Require approval. 5. Retrieve rules before task. 6. Detect direct conflicts. 7. Export to AGENTS.md + VS Code instructions. 8. Everything via MCP.

> All 8 MVP items are complete across Phases 1–5. Phase 5 adds the full
> exporter suite, diff-gated writes, and the semantic conflict hook.
