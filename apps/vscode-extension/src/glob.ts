/** Minimal glob support for rule `appliesTo` patterns (`**`, `*`, `?`). */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  // A bare directory ("app/" or "app") also covers everything beneath it.
  if (p.endsWith("/")) p += "**";
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^(?:${re})(?:/.*)?$`);
}

/** True if `relPath` (workspace-relative, any separators) matches any of the comma-separated patterns. */
export function matchesAppliesTo(appliesTo: string | null | undefined, relPath: string): boolean {
  const path = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return (appliesTo ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((pat) => globToRegExp(pat).test(path));
}
