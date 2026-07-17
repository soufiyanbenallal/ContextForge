#!/usr/bin/env node
import { createServerContext, resolveProject, defaultDbPath } from "@contextforge/mcp-server";
import { detectProject, getContext, detectConflicts, proposeLessonFromFeedback, supersedeRule, recommendCapabilities, syncCapabilities, validateAllCapabilities, checkConflictsDeep } from "@contextforge/core";
import { planExport, applyExport } from "@contextforge/exporters";
import { startServer } from "@contextforge/mcp-server";

function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string> } {
  const _: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      _.push(a);
    }
  }
  return { _: _, flags };
}

function print(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function info(msg: string): void {
  process.stderr.write(msg + "\n");
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const dbPath = flags.db ?? process.env.CONTEXTFORGE_DB ?? defaultDbPath();
  const ctx = await createServerContext(dbPath);
  const projectPath = flags.project ?? process.cwd();

  switch (cmd) {
    case "init": {
      const detected = detectProject(projectPath);
      const project = ctx.repos.upsertProject({
        name: detected.name,
        rootPath: detected.rootPath,
        gitRemote: detected.gitRemote,
        fingerprint: detected.fingerprint,
      });
      info(`Initialized ContextForge for ${project.name} (${project.id})`);
      console.log(`DB: ${dbPath}`);
      return;
    }
    case "feedback": {
      const { projectId } = resolveProject(ctx, projectPath);
      const rec = ctx.repos.recordFeedback({
        projectId,
        feedbackType: (flags.type as "accept" | "reject" | "correction") ?? "reject",
        message: flags.message ?? "",
        severity: (flags.severity as never) ?? "normal",
        classification: (flags.classification as never) ?? null,
      });
      info(`Recorded feedback ${rec.id}`);
      print(rec);
      return;
    }
    case "search": {
      const { projectId } = resolveProject(ctx, projectPath);
      const items = ctx.repos.searchKnowledge(flags.query ?? "", projectId, Number(flags.limit ?? 20));
      print(items);
      return;
    }
    case "context": {
      const { projectId } = resolveProject(ctx, projectPath);
      const result = getContext(ctx.repos, {
        projectId,
        task: flags.task,
        files: flags.files ? flags.files.split(",") : undefined,
        maxItems: flags.max ? Number(flags.max) : undefined,
      });
      print(result);
      return;
    }
    case "conflicts": {
      const { projectId } = resolveProject(ctx, projectPath);
      if (flags.deep) {
        const result = await checkConflictsDeep(ctx.repos, projectId);
        print(result);
        return;
      }
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
      print({ detected: detected.length, conflicts: created });
      return;
    }
    case "propose": {
      const { item, conflicts } = proposeLessonFromFeedback(ctx.repos, flags.feedback ?? "", {
        scopeLabel: flags.scope as never,
        appliesTo: flags.appliesTo ?? null,
      });
      info(`Proposed lesson ${item.id}`);
      if (conflicts.length) {
        info(`WARNING: ${conflicts.length} conflict(s) with existing approved rules`);
      }
      print({ item, conflicts });
      return;
    }
    case "approve": {
      const item = ctx.repos.updateKnowledgeStatus(flags.id ?? "", "approved");
      print(item);
      return;
    }
    case "reject": {
      const item = ctx.repos.updateKnowledgeStatus(flags.id ?? "", "rejected", {
        reason: flags.reason ?? null,
      });
      print(item);
      return;
    }
    case "supersede": {
      const result = supersedeRule(ctx.repos, flags.old ?? "", flags.new ?? "", flags.resolution ?? null);
      info(`Superseded ${result.old.id} -> ${result.next.id}`);
      print(result);
      return;
    }
    case "resolve": {
      const conflict = ctx.repos.resolveConflict(
        flags.id ?? "",
        flags.resolution ?? "",
        flags.supersedeLeft ?? null,
        flags.supersedeRight ?? null
      );
      print(conflict);
      return;
    }
    case "history": {
      const versions = ctx.repos.listVersions(flags.id ?? "");
      print(versions);
      return;
    }
    case "rules": {
      const { projectId } = resolveProject(ctx, projectPath);
      const items = ctx.repos.listKnowledge({
        projectId,
        status: (flags.status as never) ?? undefined,
      });
      print(items);
      return;
    }
    case "recommend": {
      const { projectId } = resolveProject(ctx, projectPath);
      const report = recommendCapabilities(ctx.repos, {
        task: flags.task,
        projectId,
        files: flags.files ? flags.files.split(",") : undefined,
      });
      print(report);
      return;
    }
    case "cap-sync": {
      const { projectId, rootPath } = resolveProject(ctx, projectPath);
      const result = syncCapabilities(ctx.repos, rootPath, projectId);
      info(`Synced capabilities: +${result.added.length} added, ${result.updated} updated`);
      print(result);
      return;
    }
    case "cap-list": {
      print(ctx.repos.listCapabilities());
      return;
    }
    case "cap-enable": {
      print(ctx.repos.setCapabilityEnabled(flags.id ?? "", true));
      return;
    }
    case "cap-disable": {
      print(ctx.repos.setCapabilityEnabled(flags.id ?? "", false));
      return;
    }
    case "cap-validate": {
      print(validateAllCapabilities(ctx.repos));
      return;
    }
    case "export": {
      const { projectId, rootPath } = resolveProject(ctx, projectPath);
      const planned = planExport(ctx.repos, projectId, rootPath);
      if (flags.plan || !flags.apply) {
        // Plan mode (safe default): show diffs, do not write.
        const changes = planned.filter((p) => p.diff);
        info(`Export plan: ${planned.length} file(s), ${changes.length} with changes. Use --apply to write.`);
        for (const f of changes) {
          process.stdout.write(`\n--- ${f.path} ---\n${f.diff}\n`);
        }
        print({ mode: "plan", files: planned.map((p) => ({ path: p.path, exists: p.exists, hasChanges: p.diff !== null })) });
        return;
      }
      const written = applyExport(planned);
      info(`Exported ${written.length} file(s).`);
      print({ mode: "applied", written });
      return;
    }
    case "serve": {
      await startServer(dbPath);
      return;
    }
    default: {
      console.log(`ContextForge CLI

Usage: contextforge <command> [--flags]

Commands:
  init                 Detect repo and register project
  feedback --type reject|accept|correction --message "..." [--severity low|normal|high|critical] [--classification ...]
  search --query "..."
  context [--task "..."] [--files a,b]
  conflicts [--deep]   Detect and record rule conflicts (--deep runs semantic check)
  propose --feedback <id> [--scope task|project|all] [--appliesTo "..."]
  approve --id <knowledgeId>
  reject  --id <knowledgeId> [--reason "..."]
  supersede --old <id> --new <id> [--resolution "..."]
  resolve --id <conflictId> --resolution "..." [--supersedeLeft <id>] [--supersedeRight <id>]
  history --id <knowledgeId>
  rules [--status approved|proposed|rejected|superseded]
  recommend [--task "..."]
  cap-sync             Discover skills/MCPs in the repo and register them
  cap-list             List registered capabilities
  cap-enable  --id <capId>
  cap-disable --id <capId>
  cap-validate         Validate required config for all capabilities
  export [--apply]     Plan (show diffs) or --apply to write AGENTS.md + .github files
  serve                Start MCP server over stdio

Global flags:
  --db <path>          SQLite DB path (default ~/.contextforge/memory.db)
  --project <path>     Project path (default cwd)
`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
