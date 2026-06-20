import type { ProviderId } from '../domain/session.js';
import { currentTimestamp, normalizeLimit } from './helpers.js';
import type { SourceManifestRecord, SourceManifestUpsertInput, SqliteDatabase } from './types.js';

interface SourceManifestRow {
  path: string;
  provider: ProviderId;
  size: number;
  mtimeMs: number;
  sha256: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastError: string | null;
}

export interface SourcesRepo {
  getByPath(path: string): SourceManifestRecord | null;
  listAll(): SourceManifestRecord[];
  listRecent(limit: number): SourceManifestRecord[];
  listByProvider(provider: ProviderId): SourceManifestRecord[];
  upsert(input: SourceManifestUpsertInput): SourceManifestRecord;
  upsertMany(inputs: readonly SourceManifestUpsertInput[]): SourceManifestRecord[];
  deleteByPath(path: string): boolean;
}

export function createSourcesRepo(db: SqliteDatabase): SourcesRepo {
  const selectByPath = db.prepare<[string], SourceManifestRow | undefined>(`
    SELECT
      path,
      provider,
      size,
      mtime_ms AS mtimeMs,
      sha256,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt,
      last_error AS lastError
    FROM sources
    WHERE path = ?
  `);

  const selectAll = db.prepare<[], SourceManifestRow>(`
    SELECT
      path,
      provider,
      size,
      mtime_ms AS mtimeMs,
      sha256,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt,
      last_error AS lastError
    FROM sources
    ORDER BY last_seen_at DESC, path ASC
  `);

  const selectRecent = db.prepare<[number], SourceManifestRow>(`
    SELECT
      path,
      provider,
      size,
      mtime_ms AS mtimeMs,
      sha256,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt,
      last_error AS lastError
    FROM sources
    ORDER BY last_seen_at DESC, path ASC
    LIMIT ?
  `);

  const selectByProvider = db.prepare<[ProviderId], SourceManifestRow>(`
    SELECT
      path,
      provider,
      size,
      mtime_ms AS mtimeMs,
      sha256,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt,
      last_error AS lastError
    FROM sources
    WHERE provider = ?
    ORDER BY last_seen_at DESC, path ASC
  `);

  const upsertStatement = db.prepare<{
    path: string;
    provider: ProviderId;
    size: number;
    mtime_ms: number;
    sha256: string;
    first_seen_at: string;
    last_seen_at: string;
    last_error: string | null;
  }>(`
    INSERT INTO sources(
      path,
      provider,
      size,
      mtime_ms,
      sha256,
      first_seen_at,
      last_seen_at,
      last_error
    )
    VALUES(
      @path,
      @provider,
      @size,
      @mtime_ms,
      @sha256,
      @first_seen_at,
      @last_seen_at,
      @last_error
    )
    ON CONFLICT(path) DO UPDATE SET
      provider = excluded.provider,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      sha256 = excluded.sha256,
      last_seen_at = excluded.last_seen_at,
      last_error = excluded.last_error
  `);

  const deleteByPath = db.prepare<[string]>(`
    DELETE FROM sources
    WHERE path = ?
  `);

  const runUpsertMany = db.transaction((inputs: readonly SourceManifestUpsertInput[]) => {
    return inputs.map((input) => {
      const timestamp = input.lastSeenAt ?? currentTimestamp();
      const firstSeenAt = input.firstSeenAt ?? timestamp;

      upsertStatement.run({
        path: input.path,
        provider: input.provider,
        size: input.size,
        mtime_ms: input.mtimeMs,
        sha256: input.sha256,
        first_seen_at: firstSeenAt,
        last_seen_at: timestamp,
        last_error: input.lastError ?? null,
      });

      const row = selectByPath.get(input.path);
      if (!row) {
        throw new Error(`Expected source manifest row for ${input.path} after upsert.`);
      }

      return mapRow(row);
    });
  });

  return {
    getByPath(sourcePath) {
      const row = selectByPath.get(sourcePath);
      return row ? mapRow(row) : null;
    },
    listAll() {
      return selectAll.all().map(mapRow);
    },
    listRecent(limit) {
      return selectRecent.all(normalizeLimit(limit)).map(mapRow);
    },
    listByProvider(provider) {
      return selectByProvider.all(provider).map(mapRow);
    },
    upsert(input) {
      const [record] = runUpsertMany([input]);
      if (!record) {
        throw new Error(`Expected source manifest row for ${input.path} after upsert.`);
      }

      return record;
    },
    upsertMany(inputs) {
      return runUpsertMany(inputs);
    },
    deleteByPath(sourcePath) {
      return deleteByPath.run(sourcePath).changes > 0;
    },
  };
}

function mapRow(row: SourceManifestRow): SourceManifestRecord {
  return {
    path: row.path,
    provider: row.provider,
    size: row.size,
    mtimeMs: row.mtimeMs,
    sha256: row.sha256,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastError: row.lastError,
  };
}
