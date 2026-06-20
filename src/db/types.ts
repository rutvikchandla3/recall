import type BetterSqlite3 from 'better-sqlite3';
import type { ProviderId, SessionDocument, Surface } from '../domain/session.js';

export type SqliteDatabase = BetterSqlite3.Database;

export interface MigrationRecord {
  name: string;
  appliedAt: string;
}

export interface SourceManifestRecord {
  path: string;
  provider: ProviderId;
  size: number;
  mtimeMs: number;
  sha256: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastError: string | null;
}

export interface SourceManifestUpsertInput {
  path: string;
  provider: ProviderId;
  size: number;
  mtimeMs: number;
  sha256: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastError?: string | null;
}

export interface ParseErrorRecord {
  path: string;
  provider: ProviderId;
  error: string;
  updatedAt: string;
}

export interface ParseErrorUpsertInput {
  path: string;
  provider: ProviderId;
  error: string;
  updatedAt?: string;
}

export interface StoredSessionDocument extends SessionDocument {
  id: number;
}

export interface RecentSessionListOptions {
  limit: number;
  includeSubagents?: boolean;
  provider?: ProviderId;
  repo?: string | null;
  branch?: string | null;
  surface?: Surface;
}
