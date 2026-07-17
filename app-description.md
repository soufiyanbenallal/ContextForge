# Agent Memory (Project Brain MCP)

> A local-first learning memory layer for AI coding agents that turns feedback and
> failures into approved, scoped project knowledge — and never edits your repo
> without a visible diff.

---

## 1. Problem

AI coding agents repeat the same mistakes. They ignore your project's
architecture, re-propose rejected approaches, and forget corrections given two
days ago. Existing instruction files (`AGENTS.md`, VS Code instructions, Claude
skills) are static and manually maintained, so they drift out of date the moment
an agent produces code you had to reject.

We need a **memory system that learns from faults and feedback**, but does so
safely: feedback becomes a *proposed* lesson, never an active permanent rule
until a human approves it.

## 2. What this app is

**Agent Memory** is a local MCP server backed by SQLite. It is the single source
of truth for a project's:

- Accepted rules and architecture decisions
- Rejected / failed approaches
- User preferences
- Skill & MCP capability registry with success tracking
- Proposed lessons awaiting approval
- Detected rule conflicts

It exposes this knowledge to **any MCP-compatible agent** (VS Code, Codex,
Claude Code, Cursor) through tools, resources, and reusable prompts. A thin VS
Code extension provides a management dashboard and one-click accept/reject UI.

It does **not** build learning logic into the editor. The core stays portable as
an MCP server.

## 3. Why MCP + SQLite + VS Code extension

- **MCP** lets the same brain serve VS Code, Claude Code, Codex, Cursor, and any
  future MCP client. Tools for actions, resources for read-only context, prompts
  for reusable workflows.
- **SQLite** is a zero-config local store, supports FTS5 for retrieval, and keeps
  all projects on the user's machine (no cloud, no secrets).
- **VS Code extension** is only a convenience dashboard. Because VS Code already
  supports instructions, prompt files, agents, skills, hooks, and MCP servers
  natively, Agent Memory *generates* those formats instead of inventing a new
  agent file format.

## 4. Architecture

```text
┌─────────────────────────────────────────────┐
│ VS Code / Codex / Claude Code / Cursor       │
│                                             │
│ AI Agent ─────── MCP calls                  │
│ VS Code extension ── feedback UI / dashboard│
└───────────────────┬─────────────────────────┘
                    │ stdio / HTTP (MCP)
┌───────────────────▼─────────────────────────┐
│ Agent Memory MCP Server                     │
│                                             │
│ 1. Project detection                        │
│ 2. Memory retrieval (get_context)           │
│ 3. Feedback recording                       │
│ 4. Lesson extraction & approval             │
│ 5. Rule conflict detection                  │
│ 6. Skill / MCP discovery & scoring          │
│ 7. Export generated instruction files       │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│ SQLite                                     │
│ projects, sessions, interactions, feedback  │
│ knowledge_items, conflicts, capabilities,   │
│ capability_usage, FTS5 index               │
└─────────────────────────────────────────────┘
```

## 5. The "learning" loop (safe by design)

Feedback never silently rewrites permanent rules.

```text
Agent gives answer / build
        ↓
You accept, reject, or correct it
        ↓
Feedback stored as an event (with source interaction)
        ↓
System extracts a PROPOSED lesson
        ↓
Checks existing rules for conflicts
        ↓
You approve → lesson becomes active project knowledge
You reject  → lesson discarded (source feedback retained)
```

Example:

```text
Rejected response: Used a third translation table.
Feedback: This project must use only form_locales and form_translations.
Extracted lesson:
  scope=project, area=database, priority=required
  "For claim-form translations, never propose additional translation
   tables unless explicitly requested."
```

## 6. Data model (SQLite)

Core tables: `projects`, `sessions`, `interactions`, `feedback`,
`knowledge_items`, `conflicts`, `capabilities`, `capability_usage`.
Plus an FTS5 virtual table `knowledge_search(title, content, category,
applies_to)` for retrieval. Full DDL in the original brief.

### Knowledge item shape

```ts
type KnowledgeCategory =
  | 'architecture' | 'coding-rule' | 'user-preference'
  | 'failed-approach' | 'accepted-pattern' | 'project-decision'
  | 'dependency-guide' | 'security-rule' | 'workflow'
  | 'skill' | 'mcp';

type KnowledgeScope =
  | 'global' | 'workspace' | 'project'
  | 'directory' | 'language' | 'task';
```

Each item carries `status` (`proposed` | `approved` | `superseded` |
`rejected`), `priority`, `confidence`, `applies_to`, `version`, and a mandatory
`source_id` back to its originating feedback.

## 7. MCP surface

### Tools

```text
memory_get_context          # retrieve relevant rules/decisions/failures before a task
memory_record_feedback      # store accept/reject/correction event
memory_propose_lesson       # extract a lesson from feedback
memory_approve_lesson       # activate a proposed lesson
memory_reject_lesson        # discard a proposed lesson
memory_search               # FTS5 + metadata filtered search
memory_find_conflicts       # detect rule conflicts
memory_resolve_conflict     # record a resolution
memory_list_project_rules   # approved rules for a project
memory_recommend_capabilities  # score skills/MCPs for a task
memory_export_instructions  # generate AGENTS.md / VS Code files
memory_analyze_workspace    # detect project type, languages, deps
```

### Resources (read-only context)

```text
memory://projects/<id>/summary
memory://projects/<id>/rules
memory://projects/<id>/failures
memory://projects/<id>/decisions
memory://projects/<id>/conflicts
memory://capabilities/mcps
memory://capabilities/skills
```

`memory_get_context({ projectPath, task, files, maxItems })` returns
`requiredRules`, `relevantDecisions`, `failedApproaches`,
`recommendedSkills`, `warnings`, `conflicts` — the agent should call this before
planning or editing.

## 8. Conflict detection (three levels)

1. **Deterministic** — same scope/category/applies_to with contradictory
   content (e.g. "UUID PK" vs "auto-increment PK").
2. **Semantic** — ask a model to compare only likely candidates and return
   `{ conflict, type, explanation, suggestedResolution }`.
3. **Precedence resolution** — explicit order, never silently resolves
   equal-priority conflicts:

   ```text
   current user instruction > task rule > directory rule > project rule
   > workspace rule > global preference > imported guide > inferred lesson
   ```

## 9. Capability registry & scoring

A `capabilities` table tracks skills and MCPs with `taskPatterns`,
`conflictsWith`, `requiredConfig`, per-project association, and a tracked
`successRate` from `capability_usage`. The recommendation engine is initially
deterministic:

```text
score = taskKeywordMatch + langFrameworkMatch + projectCompat
      + priorSuccess - knownConflicts - missingConfig
```

Returns "recommended" and "disable temporarily" lists. Fewer active tools keeps
agents faster and more relevant.

## 10. Generated repository files

The DB is the source of truth; the exporter emits concise, agent-readable files:

```text
AGENTS.md
.github/copilot-instructions.md
.github/instructions/*.instructions.md
.github/prompts/*.prompt.md
.github/agents/*.agent.md
.github/skills/<name>/SKILL.md
```

Export only approved, high-signal knowledge — never the full history. Every
export shows a diff before writing.

## 11. VS Code extension (thin dashboard)

- **Tree view**: Approved rules · Proposed lessons · Rejected approaches ·
  Conflicts · Skills & MCPs
- **Commands**: Accept Result, Reject Result, Record Correction, Save as Project
  Rule, Save as Global Preference, View Relevant Memory, Review Proposed Lessons,
  Check Rule Conflicts
- **Reject form**: free-text reason + classification (wrong code / violated
  architecture / ignored request / outdated API / over-complex / wrong tool /
  other) + scope (task / project / all)
- **Editor actions**: save selection as rule, explain rule source, show rules for
  current file, mark code accepted/rejected
- **Diagnostics**: conflicting instructions, outdated guide refs, missing
  required capability
- **Workspace Trust**: never scan scripts / execute commands / run project
  tooling until trust is granted

## 12. Repository structure (TypeScript monorepo)

```text
agent-memory/
├── apps/
│   ├── vscode-extension/
│   └── cli/
├── packages/
│   ├── core/ { feedback, retrieval, conflicts, lessons, capabilities }
│   ├── database/ { migrations, repositories }
│   ├── mcp-server/ { tools, resources, prompts }
│   ├── exporters/ { vscode, agents-md, claude }
│   └── shared/
├── examples/claium/
├── tests/
├── package.json
└── pnpm-workspace.yaml
```

Stack: Node.js + TypeScript, pnpm workspaces, SQLite via `better-sqlite3`,
Zod validation, official MCP TypeScript SDK, Vitest, custom numbered SQL
migrations.

## 13. Safety rules (enforced)

1. Never convert feedback directly into an active permanent rule.
2. Never modify repository instructions without showing a diff.
3. Never store secrets, source blobs, tokens, or env values.
4. Keep global preferences separate from project architecture.
5. Every lesson must retain its source feedback.
6. Rules can be superseded but never silently deleted.
7. Imported skills/guides are lower priority than explicit project rules.
8. Treat repositories as untrusted until Workspace Trust is granted.

## 14. Phased delivery

- **Phase 1 — CLI + MCP core**: `init`, `feedback`, `search`, `conflicts`,
  `export`, `serve` + `memory_get_context`, `memory_record_feedback`,
  `memory_search`, `memory_find_conflicts`.
- **Phase 2 — Proposed lessons**: extraction, approval workflow, scope/priority,
  versioning, superseding.
- **Phase 3 — VS Code extension**: sidebar, accept/reject, current-file rule
  view, conflict diagnostics.
- **Phase 4 — Capability manager**: skill/MCP registry, task matching, success
  tracking, config validation.
- **Phase 5 — Controlled sync**: exporters for AGENTS.md, copilot-instructions,
  `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`.

## 15. Best first version (MVP value)

Do only this, well:

1. Detect current Git repo.
2. Store feedback in project-scoped SQLite records.
3. Convert feedback into proposed lessons.
4. Require approval before activation.
5. Retrieve relevant rules before an agent task.
6. Detect direct rule conflicts.
7. Export approved rules to `AGENTS.md` + VS Code instructions.
8. Expose everything through MCP.

This alone solves most of the pain. The VS Code extension then becomes a
dashboard, not the core platform.
