// sql.js ships its own types but the resolution can be finicky under strict
// mode; we treat it loosely here.
// @ts-ignore - sql.js has types but may not resolve under pnpm strict mode
import initSqlJs from "sql.js";
type SqlJsDatabase = any;
type Statement = any;
import { MIGRATIONS } from "./migrations/schema.js";
import { nowIso } from "@contextforge/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A thin adapter exposing a better-sqlite3-like synchronous API on top of
// sql.js (pure WASM, no native addon) so the rest of the codebase is unchanged.
// sql.js is in-memory; we persist the whole database to disk after each write.

export interface PreparedQuery {
  run(...params: unknown[]): void;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DB {
  prepare(sql: string): PreparedQuery;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

let SQL: any = null;
let sqlJsInit: Promise<any> | null = null;

function wasmPath(): string {
  // Resolve the wasm next to this compiled module (dist/).
  // Works in both ESM (import.meta.url) and CJS (require.resolve) builds.
  let base: string;
  try {
    base = dirname(fileURLToPath(import.meta.url));
  } catch {
    base = __dirname;
  }
  return join(base, "sql-wasm.wasm");
}

async function getSql(): Promise<any> {
  if (SQL) return SQL;
  if (!sqlJsInit) {
    sqlJsInit = initSqlJs({ locateFile: () => wasmPath() }).then((mod: any) => {
      SQL = mod.Database;
      return SQL;
    });
  }
  return sqlJsInit;
}

function bindParams(stmt: Statement, params: unknown[]): void {
  if (params.length === 0) return;
  // sql.js supports binding an array or object.
  try {
    stmt.bind(params as never);
  } catch {
    stmt.bind(params as unknown as Record<string, unknown>);
  }
}

class SqlJsAdapter implements DB {
  private db: SqlJsDatabase;
  private path: string;

  constructor(db: SqlJsDatabase, path: string) {
    this.db = db;
    this.path = path;
  }

  private save(): void {
    const bytes = this.db.export();
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, Buffer.from(bytes));
  }

  prepare(sql: string): PreparedQuery {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        bindParams(stmt, params);
        stmt.step();
        stmt.reset();
        this.save();
      },
      get: (...params: unknown[]) => {
        bindParams(stmt, params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.reset();
          return row as unknown as Record<string, unknown>;
        }
        stmt.reset();
        return undefined;
      },
      all: (...params: unknown[]) => {
        bindParams(stmt, params);
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as unknown as Record<string, unknown>);
        stmt.reset();
        return rows;
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.save();
  }

  pragma(_sql: string): unknown {
    // sql.js has no pragmas; journaling/foreign keys are not applicable.
    return undefined;
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    // sql.js auto-commits each statement; wrap without explicit BEGIN/COMMIT
    // (which can leave a dangling transaction state). Persist after the block.
    return ((...args: never[]) => {
      const result = fn(...args);
      this.save();
      return result;
    }) as T;
  }

  close(): void {
    this.save();
    this.db.close();
  }
}

export async function openDatabase(path: string): Promise<DB> {
  const Sql = await getSql();
  let db: SqlJsDatabase;
  if (existsSync(path)) {
    db = new Sql(readFileSync(path));
  } else {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    db = new Sql();
  }
  const adapter = new SqlJsAdapter(db, path);
  migrate(adapter);
  return adapter;
}

export function migrate(db: DB): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
  );
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_migrations")
    .get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    const sql = MIGRATIONS[i];
    if (sql === undefined) continue;
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
      ).run(version, nowIso());
    });
    run();
  }
}
