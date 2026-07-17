# ContextForge

A local-first **learning memory layer for AI coding agents**. It turns agent
feedback and failures into approved, scoped project knowledge — and never edits
your repository without a visible diff.

ContextForge is used through its **VS Code extension GUI** (the primary
interface). It also ships an MCP server so other AI clients can read/write the
same memory.

See [`app-description.md`](./app-description.md) for the full product spec and
[`PLAN.md`](./PLAN.md) for the phased roadmap.

## What it does

1. Detects the current Git repository.
2. Stores feedback (accept / reject / correction) in project-scoped SQLite.
3. Converts feedback into **proposed** lessons (never active until approved).
4. Retrieves relevant rules, decisions, and failed approaches before a task.
5. Detects direct rule conflicts (deterministic + subject-based heuristics).
6. Exports approved knowledge into `AGENTS.md` and `.github/` instruction files.
7. Exposes everything through an **MCP server** reusable by VS Code, Codex,
   Claude Code, Cursor, and any MCP-compatible client.

## Using the VS Code GUI (primary)

1. Install the extension (see *Building* below) and open a **folder/workspace**
   (not a single file). Trust the workspace when prompted.
2. The **ContextForge** view appears in the Explorer sidebar (next to Files,
   Git, Extensions). **Click it** to open the full Dashboard — a visual panel
   showing Proposed / Approved rules, Conflicts, and Skills & MCPs, each with
   inline Approve / Reject / Supersede / Resolve / Enable buttons.
3. From the Dashboard (or Command Palette → *ContextForge*):
   - **Record feedback** — log a reject/correction; it lands as a proposed
     lesson you can approve in the GUI.
   - **Export instructions** — previews a diff, then writes `AGENTS.md` +
     `.github/*` into your repo on confirm.
   - **Check conflicts** — detects and records rule conflicts.

Configuration: Settings → **ContextForge → Db Path** (defaults to
`~/.contextforge/memory.db`).

## Architecture

```text
VS Code extension GUI  ──▶  ContextForge (direct DB + core)  ──▶  SQLite
AI client / MCP        ──▶  ContextForge MCP server          ──▶  SQLite
```

- `packages/shared` — Zod schemas + shared types.
- `packages/database` — SQLite (better-sqlite3), migrations, repositories, FTS5.
- `packages/core` — project detection, retrieval, conflict detection, lesson
  extraction, capability scoring.
- `packages/exporters` — render `AGENTS.md` / VS Code instruction files.
- `packages/mcp-server` — MCP tools + resources over stdio.
- `apps/cli` — `contextforge` command-line interface (power-user escape hatch;
  the GUI is the recommended way to use ContextForge).
- `apps/vscode-extension` — Explorer sidebar view + Dashboard webview GUI.

## Building

```bash
pnpm install
pnpm -r build
pnpm --filter @contextforge/tests test

# Extension vsix:
cd apps/vscode-extension && pnpm package    # -> contextforge-vscode-0.1.0.vsix
code --install-extension contextforge-vscode-0.1.0.vsix
```

For local development of the extension, open `apps/vscode-extension` in VS Code
and press **F5** (Run Extension) to launch an Extension Development Host.

## Command-line interface (optional)

The CLI is available for automation but is **not required** — everything can be
done from the GUI.

```bash
contextforge init                                                          # register the current repo
contextforge feedback --type reject \
  --message "Use only form_locales and form_translations for translations." \
  --classification violated-architecture --severity high
contextforge propose --feedback <feedbackId> --scope project --appliesTo "app/**,database/**"
contextforge approve --id <knowledgeId>
contextforge context --task "Refactor translation models" --files "app/Models/FormTranslation.php"
contextforge conflicts
contextforge export --apply     # writes AGENTS.md + .github instructions after a diff
```

Set `CONTEXTFORGE_DB` (or `--db`) to point at a specific SQLite file.

## MCP server

```bash
contextforge serve          # or: node packages/mcp-server/dist/server.js
```

Connect from any MCP client. Example `.mcp.json` (VS Code / Claude Code):

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": ["/abs/path/to/agent-memory/packages/mcp-server/dist/server.js"],
      "env": { "CONTEXTFORGE_DB": "/abs/path/to/memory.db" }
    }
  }
}
```

#### Exposed tools

`memory_get_context`, `memory_record_feedback`, `memory_search`,
`memory_find_conflicts`, `memory_propose_lesson`, `memory_approve_lesson`,
`memory_reject_lesson`, `memory_supersede_rule`, `memory_resolve_conflict`,
`memory_lesson_history`, `memory_list_project_rules`,
`memory_recommend_capabilities`, `memory_sync_capabilities`,
`memory_set_capability_enabled`, `memory_record_capability_usage`,
`memory_validate_capabilities`, `memory_export_instructions`.

#### Exposed resources

`memory://projects/<id>/{summary,rules,failures,decisions,conflicts}`,
`memory://capabilities/{mcps,skills}`.

## Phase 2: lesson lifecycle (done)

- Each knowledge item keeps a **version history** (`knowledge_versions`).
- Proposing a lesson **auto-checks for conflicts** against approved rules and
  records them immediately.
- Approved rules can be **superseded** by a newer rule; the old one is marked
  `superseded` (never deleted) and linked via `supersededBy` / `supersedes`.
  Superseding also auto-resolves open conflicts involving the old rule.
- `memory_reject_lesson` stores a rejection reason; the source feedback is
  always retained.
- Conflicts are resolved explicitly via `memory_resolve_conflict`, optionally
  superseding one side.

## Phase 3: VS Code extension (done)

The extension (`apps/vscode-extension`) is a thin dashboard backed by the same
SQLite DB and core packages — no separate logic.

- **Tree view** "Project Memory": Approved rules · Proposed lessons · Conflicts
  · Skills & MCPs, with inline approve/reject on proposed lessons.
- **Commands**: Accept Result, Reject Result, Record Correction, Save as
  Project Rule (from selection), Save as Global Preference, View Relevant
  Memory, Review Proposed Lessons, Check Rule Conflicts, Show Rules for Current
  File, Export Instructions.
- **Reject flow**: reason + classification + scope prompts.
- **Editor actions**: context menu to save selection as rule, show rules for
  current file.
- **Diagnostics**: conflicting rules surface as workspace warnings.
- **Workspace Trust**: features are disabled until the workspace is trusted;
  file writes (export) and scanning are gated on trust.

Build the extension with `pnpm --filter agent-memory-vscode build` (esbuild
bundle) and package with `pnpm --filter agent-memory-vscode package`.

## Phase 4: capability manager (done)

A registry of skills and MCP servers with task-based recommendation and
success tracking.

- **Discovery**: `memory_sync_capabilities` (CLI `cap-sync`) scans the repo for
  `.github/skills/<name>/SKILL.md` and `.mcp.json` / `mcp.json` and registers
  them automatically.
- **Scoring** (`recommendCapabilities`): returns `recommended` (task/project/
  track-record match), `disableTemporarily` (conflicting enabled caps), and
  `configIssues` (missing `requiredConfig` keys).
- **Config validation**: `memory_validate_capabilities` (CLI `cap-validate`)
  checks each capability's required env/config keys are present.
- **Lifecycle**: enable/disable (`memory_set_capability_enabled`,
  `cap-enable`/`cap-disable`), and outcome tracking
  (`memory_record_capability_usage`) that recomputes a rolling `successRate`.
- The VS Code tree shows a "Capability config issues" group when a required key
  is missing.

> Note: the recommendation engine is intentionally deterministic (no AI call)
> per the original brief — fewer active tools keep agents faster and more
> relevant.

## Phase 5: controlled synchronization (done)

The database is the source of truth; exports generate existing agent file
formats — and **never write without showing a diff first**.

- `planExport` builds all target files and computes a line-level diff against
  any existing content; `applyExport` writes only after an explicit apply.
- Generated files:
  - `AGENTS.md`
  - `.github/copilot-instructions.md`
  - `.github/instructions/<dir>.instructions.md` (per `appliesTo` scope)
  - `.github/prompts/review-feedback.prompt.md`
  - `.github/prompts/check-conflicts.prompt.md`
  - `.github/agents/project-reviewer.agent.md`
  - `.github/skills/<slug>/SKILL.md` (one per approved architecture/skill rule)
- MCP `memory_export_instructions` returns a **plan** (files + diffs) by
  default; pass `apply: true` to write. CLI `export` is plan-mode by default;
  `--apply` writes. The VS Code "Export Instructions" command shows the diff in
  an output panel and asks for confirmation (gated on Workspace Trust).
- **Semantic conflict check**: `memory_deep_conflict_check` (CLI `conflicts
  --deep`) runs the deterministic detector plus an optional model-based
  semantic pass. No model is bundled — supply a `ConflictModel` callback to
  escalate non-obvious pairs; without it, semantic candidates are declined.
- Only **approved** knowledge is exported; the full history is never written to
  the repo.

## Safety rules enforced

- Feedback never becomes an active permanent rule without approval.
- Exports show a diff before writing (Phase 5 full gating).
- No secrets, source blobs, tokens, or env values are stored.
- Rules can be superseded but never silently deleted.
- Imported skills/guides are lower priority than explicit project rules.
