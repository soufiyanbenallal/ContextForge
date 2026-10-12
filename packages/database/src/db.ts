// sql.js ships its own types but the resolution can be finicky under strict
// mode; we treat it loosely here.
// @ts-ignore - sql.js has types but may not resolve under pnpm strict mode
import initSqlJs from "sql.js";
type SqlJsDatabase = any;
type Statement = any;
import { MIGRATIONS } from "./migrations/schema.js";
import { nowIso } from "@contextforge/shared";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  rmSync,
} from "node:fs";
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

interface FileStamp {
  mtimeNs: bigint;
  ctimeNs: bigint;
  size: bigint;
  ino: bigint;
}

function stamp(path: string): FileStamp | null {
  try {
    const st = statSync(path, { bigint: true });
    return { mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs, size: st.size, ino: st.ino };
  } catch {
    return null;
  }
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.size === b.size &&
    a.ino === b.ino
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 15_000;

/**
 * sql.js is an in-memory database. Several processes (VS Code extension, MCP
 * server, CLI) open the same file, so this adapter keeps them coherent:
 *  - reads first reload the file if another process changed it;
 *  - writes take a cross-process lock, reload, apply, then save atomically
 *    (temp file + rename), so no process overwrites another's changes.
 */
class SqlJsAdapter implements DB {
  private db: SqlJsDatabase;
  private path: string;
  private lockPath: string;
  private seen: FileStamp | null;
  private lockDepth = 0;
  private dirty = false;

  constructor(db: SqlJsDatabase, path: string) {
    this.db = db;
    this.path = path;
    this.lockPath = path + ".lock";
    this.seen = stamp(path);
  }

  /**
   * Reload from disk when another process has written the file. `force`
   * skips the cheap change check (used under the write lock, where a missed
   * reload would lose another process's data).
   */
  private refresh(force = false): void {
    const now = stamp(this.path);
    if (!now || (!force && sameStamp(now, this.seen))) return;
    const next = new SQL(readFileSync(this.path));
    this.db.close();
    this.db = next;
    this.seen = now;
  }

  private acquire(): void {
    if (this.lockDepth++ > 0) return;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        mkdirSync(this.lockPath);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          this.lockDepth--;
          throw err;
        }
        try {
          if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            rmSync(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue; // lock vanished; retry immediately
        }
        if (Date.now() > deadline) {
          this.lockDepth--;
          throw new Error(`ContextForge: timed out waiting for database lock (${this.lockPath})`);
        }
        sleepSync(15);
      }
    }
    this.refresh(true);
  }

  private release(): void {
    if (--this.lockDepth > 0) return;
    rmSync(this.lockPath, { recursive: true, force: true });
  }

  private save(): void {
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, Buffer.from(this.db.export()));
    renameSync(tmp, this.path);
    this.seen = stamp(this.path);
    this.dirty = false;
  }

  /** Run a mutation under the lock; persist unless inside a transaction. */
  private write<R>(fn: () => R): R {
    this.acquire();
    try {
      const result = fn();
      this.dirty = true;
      if (this.lockDepth === 1) this.save();
      return result;
    } catch (err) {
      if (this.lockDepth === 1) this.discard();
      throw err;
    } finally {
      this.release();
    }
  }

  /** Drop unsaved in-memory changes by reloading the last saved state. */
  private discard(): void {
    this.dirty = false;
    if (!existsSync(this.path)) return;
    const next = new SQL(readFileSync(this.path));
    this.db.close();
    this.db = next;
    this.seen = stamp(this.path);
  }

  prepare(sql: string): PreparedQuery {
    const read = <R>(fn: (stmt: Statement) => R): R => {
      if (this.lockDepth === 0) this.refresh();
      const stmt = this.db.prepare(sql);
      try {
        return fn(stmt);
      } finally {
        stmt.free();
      }
    };
    return {
      run: (...params: unknown[]) =>
        this.write(() => {
          const stmt = this.db.prepare(sql);
          try {
            bindParams(stmt, params);
            stmt.step();
          } finally {
            stmt.free();
          }
        }),
      get: (...params: unknown[]) =>
        read((stmt) => {
          bindParams(stmt, params);
          return stmt.step()
            ? (stmt.getAsObject() as unknown as Record<string, unknown>)
            : undefined;
        }),
      all: (...params: unknown[]) =>
        read((stmt) => {
          bindParams(stmt, params);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject() as unknown as Record<string, unknown>);
          return rows;
        }),
    };
  }

  exec(sql: string): void {
    this.write(() => this.db.exec(sql));
  }

  pragma(_sql: string): unknown {
    // sql.js has no pragmas; journaling/foreign keys are not applicable.
    return undefined;
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    // Hold the cross-process lock for the whole block and save once at the
    // end. If the block throws, in-memory changes are discarded.
    return ((...args: never[]) => this.write(() => fn(...args))) as T;
  }

  close(): void {
    if (this.dirty) this.save();
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
