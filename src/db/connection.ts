import { chmod } from 'node:fs/promises';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { loadConfig } from '../core/config.js';
import { ensureDir, resolvePaths } from '../core/paths.js';
import { runMigrations as runDatabaseMigrations } from './migrate.js';
import type { SqliteDatabase } from './types.js';

export interface OpenDatabaseOptions {
  dbPath?: string;
  schemaDir?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  runMigrations?: boolean;
  busyTimeoutMs?: number;
}

export async function resolveDatabasePath(dbPath?: string): Promise<string> {
  if (dbPath) {
    return dbPath;
  }

  const config = await loadConfig();
  return resolvePaths(config.paths).dbPath;
}

export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<SqliteDatabase> {
  if (options.readonly && options.runMigrations === true) {
    throw new Error('Cannot run migrations with a readonly SQLite connection.');
  }

  const dbPath = await resolveDatabasePath(options.dbPath);

  if (!options.readonly) {
    await ensureDir(path.dirname(dbPath));
  }

  const dbOptions: { readonly?: boolean; fileMustExist?: boolean } = {};

  if (options.readonly !== undefined) {
    dbOptions.readonly = options.readonly;
  }

  if (options.fileMustExist !== undefined) {
    dbOptions.fileMustExist = options.fileMustExist;
  }

  const db = new BetterSqlite3(dbPath, dbOptions);

  try {
    applyConnectionPragmas(db, options.busyTimeoutMs ?? 5000, options.readonly === true);
    tryLoadVectorExtension(db);

    if (!options.readonly && options.runMigrations !== false) {
      await runDatabaseMigrations(db, options.schemaDir ? { schemaDir: options.schemaDir } : {});
    }

    if (!options.readonly) {
      await chmod(dbPath, 0o600).catch(() => undefined);
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function closeDatabase(db: SqliteDatabase): void {
  db.close();
}

export async function withDatabase<T>(
  options: OpenDatabaseOptions,
  run: (db: SqliteDatabase) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase(options);

  try {
    return await run(db);
  } finally {
    db.close();
  }
}

export function loadVectorExtension(db: SqliteDatabase): void {
  sqliteVec.load(db);
}

export function tryLoadVectorExtension(db: SqliteDatabase): boolean {
  try {
    loadVectorExtension(db);
    return true;
  } catch {
    return false;
  }
}

function applyConnectionPragmas(db: SqliteDatabase, busyTimeoutMs: number, readonly: boolean): void {
  db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
  db.pragma('foreign_keys = ON');

  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
}
