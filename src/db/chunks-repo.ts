import type { StoredSessionDocument } from './types.js';
import type { SqliteDatabase } from './types.js';
import type { ChunkRecord } from '../domain/session.js';
import { currentTimestamp } from './helpers.js';

export interface StoredChunkRecord extends ChunkRecord {
  id: number;
  sessionId: number;
  embeddingStatus: 'pending' | 'embedded' | 'failed';
  embeddingError: string | null;
  embeddedAt: string | null;
}

export interface ChunkInsertInput extends ChunkRecord {
  embedSha256: string;
}

export interface ChunksRepo {
  replaceForSession(sessionId: number, chunks: readonly ChunkInsertInput[]): StoredChunkRecord[];
  listPending(limit: number): StoredChunkRecord[];
  listDocumentsNeedingChunks(chunkVersion: string, limit: number): StoredSessionDocument[];
  markEmbedded(chunkId: number, embeddedAt?: string): void;
  markFailed(chunkId: number, error: string): void;
  countByStatus(): { total: number; pending: number; embedded: number; failed: number };
  updateSessionChunkVersion(sessionId: number, chunkVersion: string): void;
}

interface ChunkRow {
  id: number;
  sessionId: number;
  sessionUid: string;
  ord: number;
  text: string;
  approxTokens: number;
  startChar: number;
  endChar: number;
  textSha256: string;
  embedSha256: string;
  infoScore: number | null;
  embeddingStatus: 'pending' | 'embedded' | 'failed';
  embeddingError: string | null;
  embeddedAt: string | null;
}

interface StoredSessionRow {
  id: number;
  uid: string;
  provider: 'claude' | 'codex' | 'pi';
  nativeId: string;
  surface: 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  titleSource: 'native' | 'synthesized';
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

interface ChunkInsertBindings {
  session_id: number;
  ord: number;
  text: string;
  approx_tokens: number;
  start_char: number;
  end_char: number;
  text_sha256: string;
  embed_sha256: string;
  info_score: number;
}

export function createChunksRepo(db: SqliteDatabase): ChunksRepo {
  const selectChunkIdsForSession = db.prepare<[number], { id: number }>(`
    SELECT id
    FROM chunks
    WHERE session_id = ?
  `);

  let deleteVector: ReturnType<SqliteDatabase['prepare']> | null | undefined;
  const deleteChunksForSession = db.prepare<[number]>('DELETE FROM chunks WHERE session_id = ?');
  const insertChunk = db.prepare<ChunkInsertBindings>(`
    INSERT INTO chunks(
      session_id,
      ord,
      text,
      approx_tokens,
      start_char,
      end_char,
      text_sha256,
      embed_sha256,
      info_score,
      embedding_status
    )
    VALUES(
      @session_id,
      @ord,
      @text,
      @approx_tokens,
      @start_char,
      @end_char,
      @text_sha256,
      @embed_sha256,
      @info_score,
      'pending'
    )
  `);

  const selectChunksForSession = db.prepare<[number], ChunkRow>(`
    SELECT
      c.id,
      c.session_id AS sessionId,
      s.uid AS sessionUid,
      c.ord,
      c.text,
      c.approx_tokens AS approxTokens,
      c.start_char AS startChar,
      c.end_char AS endChar,
      c.text_sha256 AS textSha256,
      c.embed_sha256 AS embedSha256,
      c.info_score AS infoScore,
      c.embedding_status AS embeddingStatus,
      c.embedding_error AS embeddingError,
      c.embedded_at AS embeddedAt
    FROM chunks c
    JOIN sessions s ON s.id = c.session_id
    WHERE c.session_id = ?
    ORDER BY c.ord ASC
  `);

  const selectPending = db.prepare<[number], ChunkRow>(`
    SELECT
      c.id,
      c.session_id AS sessionId,
      s.uid AS sessionUid,
      c.ord,
      c.text,
      c.approx_tokens AS approxTokens,
      c.start_char AS startChar,
      c.end_char AS endChar,
      c.text_sha256 AS textSha256,
      c.embed_sha256 AS embedSha256,
      c.info_score AS infoScore,
      c.embedding_status AS embeddingStatus,
      c.embedding_error AS embeddingError,
      c.embedded_at AS embeddedAt
    FROM chunks c
    JOIN sessions s ON s.id = c.session_id
    WHERE c.embedding_status IN ('pending', 'failed')
    ORDER BY s.updated_at DESC, c.id ASC
    LIMIT ?
  `);

  const selectDocumentsNeedingChunks = db.prepare<[string, number], StoredSessionRow>(`
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
    WHERE s.chunk_version <> ?
      OR NOT EXISTS (SELECT 1 FROM chunks c WHERE c.session_id = s.id)
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT ?
  `);

  const markEmbeddedStatement = db.prepare<[string, number]>(`
    UPDATE chunks
    SET embedding_status = 'embedded', embedding_error = NULL, embedded_at = ?
    WHERE id = ?
  `);

  const markFailedStatement = db.prepare<[string, number]>(`
    UPDATE chunks
    SET embedding_status = 'failed', embedding_error = ?
    WHERE id = ?
  `);

  const countStatus = db.prepare<[], { total: number; pending: number; embedded: number; failed: number }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN embedding_status = 'embedded' THEN 1 ELSE 0 END) AS embedded,
      SUM(CASE WHEN embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM chunks
  `);

  const updateChunkVersion = db.prepare<[string, number]>(`
    UPDATE sessions
    SET chunk_version = ?
    WHERE id = ?
  `);

  const runReplaceForSession = db.transaction((sessionId: number, chunks: readonly ChunkInsertInput[]) => {
    for (const row of selectChunkIdsForSession.all(sessionId)) {
      deleteVectorForChunk(db, row.id, (statement) => {
        deleteVector = statement;
      }, deleteVector);
    }

    deleteChunksForSession.run(sessionId);

    for (const chunk of chunks) {
      insertChunk.run({
        session_id: sessionId,
        ord: chunk.ord,
        text: chunk.text,
        approx_tokens: chunk.approxTokens,
        start_char: chunk.startChar,
        end_char: chunk.endChar,
        text_sha256: chunk.textSha256,
        embed_sha256: chunk.embedSha256,
        info_score: chunk.infoScore ?? 0,
      });
    }

    return selectChunksForSession.all(sessionId).map(mapChunkRow);
  });

  return {
    replaceForSession(sessionId, chunks) {
      return runReplaceForSession(sessionId, chunks);
    },
    listPending(limit) {
      return selectPending.all(Math.max(1, Math.trunc(limit))).map(mapChunkRow);
    },
    listDocumentsNeedingChunks(chunkVersion, limit) {
      return selectDocumentsNeedingChunks.all(chunkVersion, Math.max(1, Math.trunc(limit))).map(mapStoredSessionRow);
    },
    markEmbedded(chunkId, embeddedAt = currentTimestamp()) {
      markEmbeddedStatement.run(embeddedAt, chunkId);
    },
    markFailed(chunkId, error) {
      markFailedStatement.run(error.slice(0, 2000), chunkId);
    },
    countByStatus() {
      const row = countStatus.get();
      return {
        total: row?.total ?? 0,
        pending: row?.pending ?? 0,
        embedded: row?.embedded ?? 0,
        failed: row?.failed ?? 0,
      };
    },
    updateSessionChunkVersion(sessionId, chunkVersion) {
      updateChunkVersion.run(chunkVersion, sessionId);
    },
  };
}

function deleteVectorForChunk(
  db: SqliteDatabase,
  chunkId: number,
  cacheStatement: (statement: ReturnType<SqliteDatabase['prepare']> | null) => void,
  statement: ReturnType<SqliteDatabase['prepare']> | null | undefined,
): void {
  if (statement === undefined) {
    try {
      const prepared = db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
      prepared.run(BigInt(chunkId));
      cacheStatement(prepared);
      return;
    } catch {
      cacheStatement(null);
      return;
    }
  }

  if (statement) {
    statement.run(BigInt(chunkId));
  }
}

function mapChunkRow(row: ChunkRow): StoredChunkRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionUid: row.sessionUid,
    ord: row.ord,
    text: row.text,
    approxTokens: row.approxTokens,
    startChar: row.startChar,
    endChar: row.endChar,
    textSha256: row.textSha256,
    embedSha256: row.embedSha256,
    infoScore: row.infoScore ?? 0,
    embeddingStatus: row.embeddingStatus,
    embeddingError: row.embeddingError,
    embeddedAt: row.embeddedAt,
  };
}

function mapStoredSessionRow(row: StoredSessionRow): StoredSessionDocument {
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
      models: parseJsonArray(row.modelsJson),
      isSubagent: row.isSubagent !== 0,
      transcriptPaths: parseJsonArray(row.transcriptPathsJson),
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

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
