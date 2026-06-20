import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDatabase, MigrationRecord } from './types.js';
import { currentTimestamp } from './helpers.js';

const MIGRATION_KEY_PREFIX = 'migration:';
const SCHEMA_VERSION_KEY = 'schema_version';
const DEFAULT_SCHEMA_DIR = fileURLToPath(new URL('../../src/db/schema', import.meta.url));

interface AppliedMigrationRow {
  key: string;
  value: string;
}

export interface RunMigrationsOptions {
  schemaDir?: string;
}

export async function resolveSchemaDir(schemaDir?: string): Promise<string> {
  const resolved = schemaDir ?? DEFAULT_SCHEMA_DIR;

  await access(resolved);

  return resolved;
}

export async function listMigrationFiles(schemaDir?: string): Promise<string[]> {
  const resolvedSchemaDir = await resolveSchemaDir(schemaDir);
  const entries = await readdir(resolvedSchemaDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /^\d+.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function getAppliedMigrations(db: SqliteDatabase): MigrationRecord[] {
  ensureMigrationTable(db);

  const rows = db
    .prepare<[string], AppliedMigrationRow>(
      `SELECT key, value
       FROM index_meta
       WHERE key LIKE ?
       ORDER BY key ASC`,
    )
    .all(`${MIGRATION_KEY_PREFIX}%`);

  return rows.map((row) => ({
    name: row.key.slice(MIGRATION_KEY_PREFIX.length),
    appliedAt: row.value,
  }));
}

export async function runMigrations(
  db: SqliteDatabase,
  options: RunMigrationsOptions = {},
): Promise<MigrationRecord[]> {
  const schemaDir = await resolveSchemaDir(options.schemaDir);
  const migrationFiles = await listMigrationFiles(schemaDir);

  ensureMigrationTable(db);

  const isApplied = db.prepare<[string], { value: string } | undefined>(
    `SELECT value
     FROM index_meta
     WHERE key = ?`,
  );
  const setMeta = db.prepare<[string, string]>(
    `INSERT INTO index_meta(key, value)
     VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const applied: MigrationRecord[] = [];

  for (const fileName of migrationFiles) {
    const migrationKey = `${MIGRATION_KEY_PREFIX}${fileName}`;
    const existing = isApplied.get(migrationKey);

    if (existing) {
      applied.push({ name: fileName, appliedAt: existing.value });
      continue;
    }

    const sqlPath = path.join(schemaDir, fileName);
    const sql = await readFile(sqlPath, 'utf8');
    const appliedAt = currentTimestamp();

    db.transaction(() => {
      db.exec(sql);
      setMeta.run(migrationKey, appliedAt);
      setMeta.run(SCHEMA_VERSION_KEY, fileName);
    })();

    applied.push({ name: fileName, appliedAt });
  }

  return applied;
}

function ensureMigrationTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}
