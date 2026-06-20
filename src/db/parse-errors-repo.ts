import { currentTimestamp, normalizeLimit } from './helpers.js';
import type { ParseErrorRecord, ParseErrorUpsertInput, SqliteDatabase } from './types.js';

interface ParseErrorRow {
  path: string;
  provider: ParseErrorRecord['provider'];
  error: string;
  updatedAt: string;
}

export interface ParseErrorsRepo {
  getByPath(path: string): ParseErrorRecord | null;
  listRecent(limit: number): ParseErrorRecord[];
  record(input: ParseErrorUpsertInput): ParseErrorRecord;
  recordMany(inputs: readonly ParseErrorUpsertInput[]): ParseErrorRecord[];
  clearPath(path: string): boolean;
  clearPaths(paths: readonly string[]): number;
}

export function createParseErrorsRepo(db: SqliteDatabase): ParseErrorsRepo {
  const selectByPath = db.prepare<[string], ParseErrorRow | undefined>(`
    SELECT
      path,
      provider,
      error,
      updated_at AS updatedAt
    FROM parse_errors
    WHERE path = ?
  `);

  const selectRecent = db.prepare<[number], ParseErrorRow>(`
    SELECT
      path,
      provider,
      error,
      updated_at AS updatedAt
    FROM parse_errors
    ORDER BY updated_at DESC, path ASC
    LIMIT ?
  `);

  const upsertStatement = db.prepare<{
    path: string;
    provider: ParseErrorRecord['provider'];
    error: string;
    updated_at: string;
  }>(`
    INSERT INTO parse_errors(path, provider, error, updated_at)
    VALUES(@path, @provider, @error, @updated_at)
    ON CONFLICT(path) DO UPDATE SET
      provider = excluded.provider,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);

  const clearPathStatement = db.prepare<[string]>(`
    DELETE FROM parse_errors
    WHERE path = ?
  `);

  const runRecordMany = db.transaction((inputs: readonly ParseErrorUpsertInput[]) => {
    return inputs.map((input) => {
      upsertStatement.run({
        path: input.path,
        provider: input.provider,
        error: input.error,
        updated_at: input.updatedAt ?? currentTimestamp(),
      });

      const row = selectByPath.get(input.path);
      if (!row) {
        throw new Error(`Expected parse error row for ${input.path} after upsert.`);
      }

      return mapRow(row);
    });
  });

  const runClearPaths = db.transaction((paths: readonly string[]) => {
    let cleared = 0;

    for (const sourcePath of paths) {
      cleared += clearPathStatement.run(sourcePath).changes;
    }

    return cleared;
  });

  return {
    getByPath(sourcePath) {
      const row = selectByPath.get(sourcePath);
      return row ? mapRow(row) : null;
    },
    listRecent(limit) {
      return selectRecent.all(normalizeLimit(limit)).map(mapRow);
    },
    record(input) {
      const [record] = runRecordMany([input]);
      if (!record) {
        throw new Error(`Expected parse error row for ${input.path} after upsert.`);
      }

      return record;
    },
    recordMany(inputs) {
      return runRecordMany(inputs);
    },
    clearPath(sourcePath) {
      return clearPathStatement.run(sourcePath).changes > 0;
    },
    clearPaths(paths) {
      return runClearPaths(paths);
    },
  };
}

function mapRow(row: ParseErrorRow): ParseErrorRecord {
  return {
    path: row.path,
    provider: row.provider,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}
