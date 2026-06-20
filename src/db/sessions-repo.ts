import type { ProviderId, Session, SessionDocument, Surface } from '../domain/session.js';
import {
  fromSqliteBoolean,
  normalizeLimit,
  parseJsonArray,
  toSqliteBoolean,
  uniqueStrings,
} from './helpers.js';
import type { RecentSessionListOptions, SqliteDatabase, StoredSessionDocument } from './types.js';

interface StoredSessionRow {
  id: number;
  uid: string;
  provider: ProviderId;
  nativeId: string;
  surface: Surface;
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  titleSource: Session['titleSource'];
  firstPrompt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  modelsJson: string;
  isSubagent: number;
  transcriptPathsJson: string;
  resumeCmd: string;
  forkCmd: string | null;
  bytes: number;
  rawBodySha256: string;
  normalizeVersion: string;
  chunkVersion: string;
  indexedAt: string;
  body: string;
}

interface SessionUpsertBindings {
  uid: string;
  provider: ProviderId;
  native_id: string;
  surface: Surface;
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  title_source: Session['titleSource'];
  first_prompt: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  models_json: string;
  is_subagent: 0 | 1;
  transcript_paths_json: string;
  resume_cmd: string;
  fork_cmd: string | null;
  bytes: number;
  raw_body_sha256: string;
  normalize_version: string;
  chunk_version: string;
  indexed_at: string;
}

interface SessionDocBindings {
  session_id: number;
  title: string;
  first_prompt: string;
  body: string;
}

interface RecentSessionBindings {
  include_subagents: 0 | 1;
  provider: ProviderId | null;
  repo: string | null;
  branch: string | null;
  surface: Surface | null;
  limit: number;
}

export interface SessionsRepo {
  getByUid(uid: string): StoredSessionDocument | null;
  upsert(document: SessionDocument): StoredSessionDocument;
  upsertMany(documents: readonly SessionDocument[]): StoredSessionDocument[];
  relinkSessionSources(uid: string, sourcePaths: readonly string[]): number;
  listRecent(options: RecentSessionListOptions): StoredSessionDocument[];
}

export function createSessionsRepo(db: SqliteDatabase): SessionsRepo {
  const selectByUid = db.prepare<[string], StoredSessionRow | undefined>(`
    SELECT
      s.id,
      s.uid,
      s.provider,
      s.native_id AS nativeId,
      s.surface,
      s.cwd,
      s.repo,
      s.branch,
      s.title,
      s.title_source AS titleSource,
      s.first_prompt AS firstPrompt,
      s.created_at AS createdAt,
      s.updated_at AS updatedAt,
      s.message_count AS messageCount,
      s.models_json AS modelsJson,
      s.is_subagent AS isSubagent,
      s.transcript_paths_json AS transcriptPathsJson,
      s.resume_cmd AS resumeCmd,
      s.fork_cmd AS forkCmd,
      s.bytes,
      s.raw_body_sha256 AS rawBodySha256,
      s.normalize_version AS normalizeVersion,
      s.chunk_version AS chunkVersion,
      s.indexed_at AS indexedAt,
      d.body
    FROM sessions s
    JOIN session_docs d ON d.session_id = s.id
    WHERE s.uid = ?
  `);

  const selectIdByUid = db.prepare<[string], { id: number } | undefined>(`
    SELECT id
    FROM sessions
    WHERE uid = ?
  `);

  const upsertSession = db.prepare<SessionUpsertBindings>(`
    INSERT INTO sessions(
      uid,
      provider,
      native_id,
      surface,
      cwd,
      repo,
      branch,
      title,
      title_source,
      first_prompt,
      created_at,
      updated_at,
      message_count,
      models_json,
      is_subagent,
      transcript_paths_json,
      resume_cmd,
      fork_cmd,
      bytes,
      raw_body_sha256,
      normalize_version,
      chunk_version,
      indexed_at
    )
    VALUES(
      @uid,
      @provider,
      @native_id,
      @surface,
      @cwd,
      @repo,
      @branch,
      @title,
      @title_source,
      @first_prompt,
      @created_at,
      @updated_at,
      @message_count,
      @models_json,
      @is_subagent,
      @transcript_paths_json,
      @resume_cmd,
      @fork_cmd,
      @bytes,
      @raw_body_sha256,
      @normalize_version,
      @chunk_version,
      @indexed_at
    )
    ON CONFLICT(uid) DO UPDATE SET
      provider = excluded.provider,
      native_id = excluded.native_id,
      surface = excluded.surface,
      cwd = excluded.cwd,
      repo = excluded.repo,
      branch = excluded.branch,
      title = excluded.title,
      title_source = excluded.title_source,
      first_prompt = excluded.first_prompt,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      message_count = excluded.message_count,
      models_json = excluded.models_json,
      is_subagent = excluded.is_subagent,
      transcript_paths_json = excluded.transcript_paths_json,
      resume_cmd = excluded.resume_cmd,
      fork_cmd = excluded.fork_cmd,
      bytes = excluded.bytes,
      raw_body_sha256 = excluded.raw_body_sha256,
      normalize_version = excluded.normalize_version,
      chunk_version = excluded.chunk_version,
      indexed_at = excluded.indexed_at
  `);

  const upsertSessionDoc = db.prepare<SessionDocBindings>(`
    INSERT INTO session_docs(session_id, title, first_prompt, body)
    VALUES(@session_id, @title, @first_prompt, @body)
    ON CONFLICT(session_id) DO UPDATE SET
      title = excluded.title,
      first_prompt = excluded.first_prompt,
      body = excluded.body
  `);

  const deleteSessionSourceLinks = db.prepare<[number]>(`
    DELETE FROM session_sources
    WHERE session_id = ?
  `);

  const insertSessionSourceLink = db.prepare<[number, string]>(`
    INSERT OR IGNORE INTO session_sources(session_id, path)
    SELECT ?, path
    FROM sources
    WHERE path = ?
  `);

  const selectRecent = db.prepare<RecentSessionBindings, StoredSessionRow>(`
    SELECT
      s.id,
      s.uid,
      s.provider,
      s.native_id AS nativeId,
      s.surface,
      s.cwd,
      s.repo,
      s.branch,
      s.title,
      s.title_source AS titleSource,
      s.first_prompt AS firstPrompt,
      s.created_at AS createdAt,
      s.updated_at AS updatedAt,
      s.message_count AS messageCount,
      s.models_json AS modelsJson,
      s.is_subagent AS isSubagent,
      s.transcript_paths_json AS transcriptPathsJson,
      s.resume_cmd AS resumeCmd,
      s.fork_cmd AS forkCmd,
      s.bytes,
      s.raw_body_sha256 AS rawBodySha256,
      s.normalize_version AS normalizeVersion,
      s.chunk_version AS chunkVersion,
      s.indexed_at AS indexedAt,
      d.body
    FROM sessions s
    JOIN session_docs d ON d.session_id = s.id
    WHERE (@include_subagents = 1 OR s.is_subagent = 0)
      AND (@provider IS NULL OR s.provider = @provider)
      AND (@repo IS NULL OR s.repo = @repo)
      AND (@branch IS NULL OR s.branch = @branch)
      AND (@surface IS NULL OR s.surface = @surface)
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT @limit
  `);

  const runRelinkSessionSources = db.transaction((uid: string, sourcePaths: readonly string[]) => {
    const sessionId = selectIdByUid.get(uid)?.id;

    if (!sessionId) {
      throw new Error(`Cannot relink sources for missing session ${uid}.`);
    }

    deleteSessionSourceLinks.run(sessionId);

    let linked = 0;
    for (const sourcePath of uniqueStrings([...sourcePaths])) {
      linked += insertSessionSourceLink.run(sessionId, sourcePath).changes;
    }

    return linked;
  });

  const runUpsertMany = db.transaction((documents: readonly SessionDocument[]) => {
    return documents.map((document) => {
      const { session } = document;
      const models = uniqueStrings(session.models);
      const transcriptPaths = uniqueStrings(session.transcriptPaths);

      upsertSession.run({
        uid: session.uid,
        provider: session.provider,
        native_id: session.nativeId,
        surface: session.surface,
        cwd: session.cwd,
        repo: session.repo,
        branch: session.branch,
        title: session.title,
        title_source: session.titleSource,
        first_prompt: session.firstPrompt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        message_count: session.messageCount,
        models_json: JSON.stringify(models),
        is_subagent: toSqliteBoolean(session.isSubagent),
        transcript_paths_json: JSON.stringify(transcriptPaths),
        resume_cmd: session.resumeCmd,
        fork_cmd: session.forkCmd,
        bytes: session.bytes,
        raw_body_sha256: document.rawBodySha256,
        normalize_version: document.normalizeVersion,
        chunk_version: document.chunkVersion,
        indexed_at: document.indexedAt,
      });

      const sessionId = selectIdByUid.get(session.uid)?.id;
      if (!sessionId) {
        throw new Error(`Expected session id for ${session.uid} after upsert.`);
      }

      upsertSessionDoc.run({
        session_id: sessionId,
        title: session.title,
        first_prompt: session.firstPrompt,
        body: document.body,
      });

      deleteSessionSourceLinks.run(sessionId);
      for (const sourcePath of transcriptPaths) {
        insertSessionSourceLink.run(sessionId, sourcePath);
      }

      const stored = selectByUid.get(session.uid);
      if (!stored) {
        throw new Error(`Expected stored session document for ${session.uid} after upsert.`);
      }

      return mapStoredRow(stored);
    });
  });

  return {
    getByUid(uid) {
      const row = selectByUid.get(uid);
      return row ? mapStoredRow(row) : null;
    },
    upsert(document) {
      const [stored] = runUpsertMany([document]);
      if (!stored) {
        throw new Error(`Expected stored session document for ${document.session.uid} after upsert.`);
      }

      return stored;
    },
    upsertMany(documents) {
      return runUpsertMany(documents);
    },
    relinkSessionSources(uid, sourcePaths) {
      return runRelinkSessionSources(uid, sourcePaths);
    },
    listRecent(options) {
      const bindings: RecentSessionBindings = {
        include_subagents: toSqliteBoolean(options.includeSubagents ?? false),
        provider: options.provider ?? null,
        repo: options.repo ?? null,
        branch: options.branch ?? null,
        surface: options.surface ?? null,
        limit: normalizeLimit(options.limit),
      };

      return selectRecent.all(bindings).map(mapStoredRow);
    },
  };
}

function mapStoredRow(row: StoredSessionRow): StoredSessionDocument {
  return {
    id: row.id,
    session: {
      uid: row.uid,
      provider: row.provider,
      nativeId: row.nativeId,
      surface: row.surface,
      cwd: row.cwd,
      repo: row.repo,
      branch: row.branch,
      title: row.title,
      titleSource: row.titleSource,
      firstPrompt: row.firstPrompt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount,
      models: parseJsonArray<string>(row.modelsJson),
      isSubagent: fromSqliteBoolean(row.isSubagent),
      transcriptPaths: parseJsonArray<string>(row.transcriptPathsJson),
      resumeCmd: row.resumeCmd,
      forkCmd: row.forkCmd,
      bytes: row.bytes,
    },
    body: row.body,
    rawBodySha256: row.rawBodySha256,
    normalizeVersion: row.normalizeVersion,
    chunkVersion: row.chunkVersion,
    indexedAt: row.indexedAt,
  };
}
