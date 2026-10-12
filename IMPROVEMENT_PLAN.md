# ContextForge — Fix & Redesign Plan

Based on reading the code (extension, database, core, MCP server, spec). I have
**not** run the extension in a real VS Code window yet, so Phase 0 starts by
reproducing each problem below.

## 1. Why it doesn't work as expected (root causes found)

| # | Problem | Where | Effect |
|---|---------|-------|--------|
| 1 | **Every process has its own copy of the DB.** sql.js is in-memory and rewrites the *whole file* after each statement. Extension, MCP server and CLI each load their own copy. | `packages/database/src/db.ts` | Last writer wins and silently erases the others' data. The extension never sees what the agent saved via MCP. This is the most likely cause of "nothing works as you explained". |
| 2 | Clicking the sidebar does not open the dashboard. `clickCommand` is not a valid view property. The README says "Explorer sidebar" but it is an Activity Bar container. | `package.json` | The primary entry point looks dead. |
| 3 | Inline ✓/✗ on a tree item ignores the clicked item. It opens a QuickPick of *all* proposed lessons. | `commands.ts` `approveLesson` | Approving feels broken and confusing. |
| 4 | Terminal capture matches any output containing "error"/"failed", then creates a lesson plus a toast. `onDidWriteTerminalData` is not a stable API. | `capture.ts` | Noisy junk proposals; the user stops trusting the inbox. |
| 5 | Feedback has no connection to what the agent did. The user types 3 prompts (message, severity, classification) with no diff, file or agent response. | `commands.ts` `recordFeedback` | Accept/Reject is not at the point of decision, so it is slow and context-free. |
| 6 | Dashboard is a string-built HTML table, fully re-rendered after each click. No filter, search, detail view, edit or undo. Reject, supersede and resolve use bare input boxes. | `dashboard.ts` | Poor UX. A conflict shows only text, not the two rules side by side, and resolving doesn't ask which rule wins. |
| 7 | Nothing makes the agent *use* the memory. No setup of `.mcp.json` or an instruction telling agents to call `memory_get_context`. | whole project | The learning loop never closes. |
| 8 | Smaller issues: Windows path bug (`lastIndexOf("/")`); `createOutputChannel` called on every command (leaks); rule-for-file matching is a substring check, not globs; conflict check can re-create duplicates; 3 `.vsix` binaries committed; tests use a `vscode` stub, so nothing validates the real extension. | various | Fragile behaviour. |

## 2. Target design

**Principle:** one source of truth, a thin editor client, and decisions made
*where the work happens* (in the editor, on the diff), not in a separate dashboard.

```text
Extension (UI only) ──┐
CLI                  ─┼──► ContextForge service (single DB owner) ──► SQLite (WAL)
MCP server (agents)  ─┘
```

- **One DB owner.** Switch to real SQLite (`better-sqlite3`, WAL mode, per-platform VSIX) so concurrent access is safe, and add a file watcher so the UI updates live when an agent writes. Fallback if native builds are a problem: a tiny local service the three clients talk to.
- **Extension has no business logic.** It calls a typed `ContextForgeClient` API (same functions as the MCP tools).
- **Dashboard HTML strings → a small webview app** (Preact/Svelte + VS Code theme tokens), with state, so actions don't re-render the page.

## 3. New UX — where each action lives

1. **Review Inbox (main screen, editor tab).** Master–detail list of proposed lessons. Detail shows the rule, the originating feedback/fault, affected files, and any conflicts. Actions: **Approve · Edit & approve · Reject (with reason chips) · Merge into existing**. Keyboard: `A` / `R` / `E` / `J`/`K`. Batch select. Undo toast.
2. **Conflicts → native VS Code diff editor.** Open the two rules side by side. One click: *Keep left / Keep right / Merge / Scope both differently*. Resolution records why.
3. **In the editor, at the moment of the mistake:**
   - Right-click a selection or SCM diff hunk → **"Teach ContextForge: this was wrong"** → one small inline form (pre-filled with the code/diff and file glob).
   - **CodeLens / hover** at the top of a file: "3 rules apply" → click to see them.
   - **Diagnostics + Quick Fix** on a line that violates a rule.
   - **Status bar item** `ContextForge ● 4 to review` → opens the Inbox.
4. **Slim sidebar.** Sections: Inbox (with badge), Rules, Conflicts, Capabilities. Proper welcome views when empty ("Connect your agent", "Record first lesson"). Inline actions act on the *clicked item*.
5. **Export = native diff per file** (`vscode.diff`), with *Apply all / Apply file*. Never writes without it.
6. **First-run "Connect agents" wizard.** Writes `.mcp.json`, adds the "call `memory_get_context` before work, `memory_record_feedback` after rejections" instruction to `AGENTS.md`/`copilot-instructions.md` (via the diff flow), and verifies the connection.
7. **Quiet capture.** Passive capture becomes opt-in, uses task exit codes + Problems panel only (no terminal scraping), dedupes by fingerprint, batches into one "N new candidates" inbox entry, and has an ignore list. No toast per error.

## 4. Phases

**Phase 0 — Reproduce & guard (1–2 days)**
- Reproduce #1–#8 in an Extension Development Host; add an E2E test using `@vscode/test-electron`.
- Add a concurrency test: extension + MCP writing the same DB.

**Phase 1 — Make it correct (3–5 days)**
- Replace sql.js with WAL SQLite; DB file watcher → live refresh; fix path handling.
- Fix tree inline actions to use the clicked item; fix the sidebar entry point; welcome views; status-bar badge.
- Remove terminal scraping; dedupe/debounce; reuse a single output channel; glob matching (`minimatch`) for rules-for-file; dedupe conflict creation.
- Remove `.vsix` files from git (add to `.gitignore`, build in CI).

**Phase 2 — New review experience (1 week)**
- Webview Inbox (master–detail, edit, reasons, batch, undo).
- Conflict diff resolver; export via native diff.

**Phase 3 — In-editor feedback loop (1 week)**
- "Teach ContextForge" from selection/diff hunk; CodeLens/hover; Quick Fix on violations.
- "Connect agents" wizard + instruction injection; verify MCP round-trip.

**Phase 4 — Polish (3–5 days)**
- Settings (capture on/off, ignore globs), onboarding walkthrough, accessibility pass, README rewritten to match real behaviour, CI (lint, typecheck, unit, E2E), marketplace-ready packaging.

## 5. Definition of done
1. An agent saves a lesson via MCP and it appears in the open Inbox within ~1s, with no data lost under concurrent writes.
2. A user can reject an agent change from the editor in ≤2 clicks and see the proposed rule.
3. Approve/reject/resolve each take one action on the item the user clicked.
4. Export always shows a native diff and writes nothing without Apply.
5. E2E tests run the real extension in VS Code in CI.

## 6. Decisions needed from you
- **DB approach:** `better-sqlite3` per-platform VSIX (recommended) vs. a local service.
- **Agent targets to prioritise:** Copilot / Claude Code / Cursor / Codex?
- **Passive capture:** keep (opt-in) or drop entirely?

## 7. Progress

**Done (this branch)**
- Phase 0: reproduced #1 (lost writes between two DB handles) with `tests/concurrency.test.ts`, including a 4-process stress test.
- Phase 1, partial:
  - #1 fixed. The sql.js adapter now takes a cross-process lock, reloads on external change and saves atomically. I kept sql.js instead of `better-sqlite3` because native modules inside VS Code's Electron need per-platform/ABI builds; the correctness problem is solved either way. Revisit if write volume grows.
  - #2 dashboard entry is now a tree item ("Open dashboard — N to review"); the invalid `clickCommand` is removed.
  - #3 inline approve/reject act on the clicked item; cancelling the reject prompt no longer rejects.
  - #4 terminal scraping removed; task-failure capture is opt-in (`contextforge.captureFaults`, default off).
  - #8 Windows path bug, output-channel leak, glob matching, duplicate conflicts, relative-path diagnostics, `.vsix` files removed from git.

**Not started**: live refresh via file watcher, status-bar badge, Phase 2 (Inbox webview, diff-based conflicts/export), Phase 3 (in-editor feedback, Connect agents wizard), real-VS-Code E2E tests.
