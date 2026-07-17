import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function splitPatterns(appliesTo: string | null): string[] {
  if (!appliesTo) return [];
  return appliesTo
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
