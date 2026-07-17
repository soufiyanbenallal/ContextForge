import { ServerContext, resolveProject } from "../context.js";

export interface ResourceEntry {
  uri: string;
  name: string;
  text: string;
}

export function listResourceTemplates(): { uriTemplate: string; name: string }[] {
  return [
    { uriTemplate: "memory://projects/{id}/summary", name: "Project summary" },
    { uriTemplate: "memory://projects/{id}/rules", name: "Approved rules" },
    { uriTemplate: "memory://projects/{id}/failures", name: "Rejected approaches" },
    { uriTemplate: "memory://projects/{id}/decisions", name: "Decisions" },
    { uriTemplate: "memory://projects/{id}/conflicts", name: "Conflicts" },
    { uriTemplate: "memory://capabilities/mcps", name: "MCP capabilities" },
    { uriTemplate: "memory://capabilities/skills", name: "Skill capabilities" },
  ];
}

export function readResource(
  ctx: ServerContext,
  uri: string
): ResourceEntry | null {
  const mcps = "memory://capabilities/mcps";
  const skills = "memory://capabilities/skills";
  if (uri === mcps || uri === skills) {
    const type = uri === mcps ? "mcp" : "skill";
    const caps = ctx.repos
      .listCapabilities()
      .filter((c) => c.type === type);
    return { uri, name: type, text: JSON.stringify(caps, null, 2) };
  }

  const m = uri.match(/^memory:\/\/projects\/([^/]+)\/(summary|rules|failures|decisions|conflicts)$/);
  if (!m) return null;
  const id = m[1]!;
  const kind = m[2]!;
  const project = ctx.repos.getProject(id);
  if (!project) return null;

  let text: string;
  switch (kind) {
    case "summary":
      text = JSON.stringify(project, null, 2);
      break;
    case "rules":
      text = JSON.stringify(
        ctx.repos.listKnowledge({ projectId: id, status: "approved" }),
        null,
        2
      );
      break;
    case "failures":
      text = JSON.stringify(
        ctx.repos
          .listKnowledge({ projectId: id, status: "approved" })
          .filter((i) => i.category === "failed-approach"),
        null,
        2
      );
      break;
    case "decisions":
      text = JSON.stringify(
        ctx.repos
          .listKnowledge({ projectId: id, status: "approved" })
          .filter(
            (i) =>
              i.category === "project-decision" ||
              i.category === "architecture"
          ),
        null,
        2
      );
      break;
    case "conflicts":
      text = JSON.stringify(
        ctx.repos.listConflicts(id),
        null,
        2
      );
      break;
    default:
      return null;
  }
  return { uri, name: `${project.name}/${kind}`, text };
}
