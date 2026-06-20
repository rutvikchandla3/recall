import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { defaultAdapters } from '../adapters/index.js';
import type { SessionAdapter } from '../adapters/types.js';
import { loadConfig, type RecallConfig } from '../core/config.js';
import { createLogger, type Logger } from '../core/logger.js';
import { createProgressReporter, type ProgressReporter } from '../core/progress.js';
import {
  openDatabase,
  closeDatabase,
  createParseErrorsRepo,
  createSessionsRepo,
  createSourcesRepo,
  type ParseErrorUpsertInput,
} from '../db/index.js';
import type { ProviderId, SessionDocument } from '../domain/session.js';
import type { StoredSessionDocument } from '../db/types.js';
import { discoverSessions } from './discover.js';
import { normalizeParsedSessions } from './normalize.js';
import { parseDiscoveredSessions } from './ingest.js';
import { indexSemanticDocuments, type SemanticIndexSummary, type SemanticProgressEvent } from './semantic-index.js';

export interface SyncOptions {
  full?: boolean;
  provider?: ProviderId;
  quiet?: boolean;
  config?: RecallConfig;
  logger?: Logger;
}

export interface SyncSummary {
  discovered: number;
  changed: number;
  indexed: number;
  failed: number;
  deletedSources: number;
  deletedSessions: number;
  chunkedSessions: number;
  chunks: number;
  embeddedChunks: number;
  reusedEmbeddings: number;
  embeddingFailures: number;
  semanticEnabled: boolean;
}

const ALWAYS_REPARSE_PROVIDER = new Set<ProviderId>(['pi']);

export async function runSync(options: SyncOptions = {}): Promise<SyncSummary> {
  const config = options.config ?? await loadConfig();
  const logger = options.logger ?? createLogger(options.quiet !== undefined ? { quiet: options.quiet } : {});
  const adapters = selectAdapters(options.provider);
  const db = await openDatabase({ runMigrations: true });

  try {
    if (options.full) {
      clearProviderState(db, options.provider);
    }

    const sourcesRepo = createSourcesRepo(db);
    const sessionsRepo = createSessionsRepo(db);
    const parseErrorsRepo = createParseErrorsRepo(db);
    const discovered = await discoverSessions({ adapters, config });
    const discoveredPaths = new Set(discovered.map((candidate) => candidate.path));

    let deletedSources = 0;
    for (const provider of adapters.map((adapter) => adapter.id)) {
      for (const existing of sourcesRepo.listByProvider(provider)) {
        if (discoveredPaths.has(existing.path)) {
          continue;
        }

        deletedSources += Number(sourcesRepo.deleteByPath(existing.path));
        parseErrorsRepo.clearPath(existing.path);
      }
    }

    const changedCandidates = discovered.filter((candidate) => {
      if (ALWAYS_REPARSE_PROVIDER.has(candidate.provider)) {
        return true;
      }

      const existing = sourcesRepo.getByPath(candidate.path);
      return !existing
        || existing.size !== candidate.size
        || existing.mtimeMs !== candidate.mtimeMs;
    });

    logger.info(`Discovered ${discovered.length} session files`);
    logger.info(`Parsing ${changedCandidates.length} changed session files`);
    const parseProgress = createProgressReporter({
      label: 'Parsing sessions',
      total: changedCandidates.length,
      enabled: !options.quiet && changedCandidates.length > 0,
    });

    const sourceRecords = await Promise.all(
      discovered.map(async (candidate) => {
        const existing = sourcesRepo.getByPath(candidate.path);
        const shouldHash = options.full || !existing || existing.size !== candidate.size || existing.mtimeMs !== candidate.mtimeMs;
        const sha256 = shouldHash ? await hashFile(candidate.path) : existing.sha256;

        return {
          path: candidate.path,
          provider: candidate.provider,
          size: candidate.size,
          mtimeMs: candidate.mtimeMs,
          sha256,
          lastError: null,
        };
      }),
    );

    sourcesRepo.upsertMany(sourceRecords);

    const { parsed, failures } = await parseDiscoveredSessions(changedCandidates, adapters, {
      onProgress(event) {
        parseProgress.update(event.current, event.provider);
      },
    });
    parseProgress.finish(`Parsed ${changedCandidates.length} files (${parsed.length} sessions, ${failures.length} failures).`);
    const documents = await normalizeParsedSessions(parsed, {
      preferPiSessionIdFallback: config.launch.preferPiSessionIdFallback,
    });

    let storedDocuments: StoredSessionDocument[] = [];
    if (documents.length > 0) {
      storedDocuments = upsertSessionDocuments(sessionsRepo, documents);
    }

    const failureInputs: ParseErrorUpsertInput[] = failures.map((failure) => ({
      path: failure.path,
      provider: failure.provider,
      error: failure.error,
    }));

    if (failureInputs.length > 0) {
      parseErrorsRepo.recordMany(failureInputs);
    }

    const succeededPaths = new Set(parsed.flatMap((session) => session.transcriptPaths));
    const clearedPaths = [...succeededPaths].filter((sourcePath) => !failures.some((failure) => failure.path === sourcePath));
    if (clearedPaths.length > 0) {
      parseErrorsRepo.clearPaths(clearedPaths);
    }

    const deletedSessions = cleanupOrphanSessions(db);
    const semanticProgress = createSemanticProgressReporter(!options.quiet);
    const semanticSummary = await runSemanticIndex(db, storedDocuments, config, logger, semanticProgress.onProgress);
    semanticProgress.finish();

    return {
      discovered: discovered.length,
      changed: changedCandidates.length,
      indexed: documents.length,
      failed: failures.length,
      deletedSources,
      deletedSessions,
      chunkedSessions: semanticSummary.chunkedSessions,
      chunks: semanticSummary.chunks,
      embeddedChunks: semanticSummary.embeddedChunks,
      reusedEmbeddings: semanticSummary.reusedEmbeddings,
      embeddingFailures: semanticSummary.embeddingFailures,
      semanticEnabled: semanticSummary.semanticEnabled,
    };
  } finally {
    closeDatabase(db);
  }
}

function selectAdapters(provider: ProviderId | undefined): SessionAdapter[] {
  if (!provider) {
    return defaultAdapters;
  }

  return defaultAdapters.filter((adapter) => adapter.id === provider);
}

function upsertSessionDocuments(
  sessionsRepo: ReturnType<typeof createSessionsRepo>,
  documents: readonly SessionDocument[],
): StoredSessionDocument[] {
  return sessionsRepo.upsertMany(documents);
}

function createSemanticProgressReporter(enabled: boolean): {
  onProgress?: (event: SemanticProgressEvent) => void;
  finish(): void;
} {
  if (!enabled) {
    return {
      finish() {},
    };
  }

  let chunkProgress: ProgressReporter | undefined;
  let embedProgress: ProgressReporter | undefined;
  let chunkDone = false;
  let embedDone = false;

  return {
    onProgress(event) {
      if (event.total <= 0) {
        return;
      }

      if (event.phase === 'chunk') {
        chunkProgress ??= createProgressReporter({ label: 'Chunking sessions', total: event.total });
        chunkProgress.update(event.current, event.detail);
        if (!chunkDone && event.current >= event.total) {
          chunkDone = true;
          chunkProgress.finish(`Chunked ${event.total} sessions.`);
        }
        return;
      }

      embedProgress ??= createProgressReporter({ label: 'Embedding chunks', total: event.total, minIntervalMs: 500 });
      embedProgress.update(event.current, event.detail);
      if (!embedDone && event.current >= event.total) {
        embedDone = true;
        embedProgress.finish(`Embedded ${event.total} chunks.`);
      }
    },
    finish() {
      if (chunkProgress && !chunkDone) {
        chunkProgress.finish();
        chunkDone = true;
      }
      if (embedProgress && !embedDone) {
        embedProgress.finish();
        embedDone = true;
      }
    },
  };
}

async function runSemanticIndex(
  db: Awaited<ReturnType<typeof openDatabase>>,
  documents: readonly StoredSessionDocument[],
  config: RecallConfig,
  logger: Logger,
  onProgress?: (event: SemanticProgressEvent) => void,
): Promise<SemanticIndexSummary> {
  try {
    return await indexSemanticDocuments(db, documents, config, logger, onProgress ? { onProgress } : {});
  } catch (error) {
    logger.warn(`Semantic indexing skipped: ${error instanceof Error ? error.message : String(error)}`);
    return {
      chunkedSessions: 0,
      chunks: 0,
      embeddedChunks: 0,
      reusedEmbeddings: 0,
      embeddingFailures: 1,
      semanticEnabled: false,
    };
  }
}

function clearProviderState(db: Awaited<ReturnType<typeof openDatabase>>, provider?: ProviderId): void {
  if (!provider) {
    deleteVectorRows(db);
    db.exec(`
      DELETE FROM parse_errors;
      DELETE FROM session_sources;
      DELETE FROM chunks;
      DELETE FROM session_docs;
      DELETE FROM sessions;
      DELETE FROM sources;
    `);
    return;
  }

  deleteVectorRows(db, provider);

  const deleteChunks = db.prepare<[ProviderId]>(`
    DELETE FROM chunks
    WHERE session_id IN (SELECT id FROM sessions WHERE provider = ?)
  `);
  const deleteSessionSources = db.prepare<[ProviderId]>(`
    DELETE FROM session_sources
    WHERE session_id IN (SELECT id FROM sessions WHERE provider = ?)
  `);
  const deleteSessionDocs = db.prepare<[ProviderId]>(`
    DELETE FROM session_docs
    WHERE session_id IN (SELECT id FROM sessions WHERE provider = ?)
  `);
  const deleteSessions = db.prepare<[ProviderId]>('DELETE FROM sessions WHERE provider = ?');
  const deleteParseErrors = db.prepare<[ProviderId]>('DELETE FROM parse_errors WHERE provider = ?');
  const deleteSources = db.prepare<[ProviderId]>('DELETE FROM sources WHERE provider = ?');

  db.transaction(() => {
    deleteSessionSources.run(provider);
    deleteChunks.run(provider);
    deleteSessionDocs.run(provider);
    deleteSessions.run(provider);
    deleteParseErrors.run(provider);
    deleteSources.run(provider);
  })();
}

function deleteVectorRows(db: Awaited<ReturnType<typeof openDatabase>>, provider?: ProviderId): void {
  try {
    if (!provider) {
      db.prepare('DELETE FROM chunk_embeddings').run();
      return;
    }

    const ids = db.prepare<[ProviderId], { id: number }>(`
      SELECT c.id
      FROM chunks c
      JOIN sessions s ON s.id = c.session_id
      WHERE s.provider = ?
    `).all(provider);
    const deleteVector = db.prepare<[bigint]>('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
    for (const row of ids) {
      deleteVector.run(BigInt(row.id));
    }
  } catch {
    // Vector table may not exist yet; normal relational cleanup still applies.
  }
}

function cleanupOrphanSessions(db: Awaited<ReturnType<typeof openDatabase>>): number {
  try {
    const orphanChunkIds = db.prepare<[], { id: number }>(`
      SELECT c.id
      FROM chunks c
      JOIN sessions s ON s.id = c.session_id
      WHERE s.id NOT IN (
        SELECT DISTINCT session_id
        FROM session_sources
      )
    `).all();
    const deleteVector = db.prepare<[bigint]>('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
    for (const row of orphanChunkIds) {
      deleteVector.run(BigInt(row.id));
    }
  } catch {
    // Vector table may not exist yet.
  }

  const deleteOrphans = db.prepare(`
    DELETE FROM sessions
    WHERE id NOT IN (
      SELECT DISTINCT session_id
      FROM session_sources
    )
  `);

  return deleteOrphans.run().changes;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath, { encoding: 'utf8' }) as Readable;

  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}
