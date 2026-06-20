import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { defaultAdapters } from '../adapters/index.js';
import type { SessionAdapter } from '../adapters/types.js';
import { loadConfig, type RecallConfig } from '../core/config.js';
import { createLogger, type Logger } from '../core/logger.js';
import {
  openDatabase,
  closeDatabase,
  createParseErrorsRepo,
  createSessionsRepo,
  createSourcesRepo,
  type ParseErrorUpsertInput,
} from '../db/index.js';
import type { ProviderId, SessionDocument } from '../domain/session.js';
import { discoverSessions } from './discover.js';
import { normalizeParsedSessions } from './normalize.js';
import { parseDiscoveredSessions } from './ingest.js';

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

    const { parsed, failures } = await parseDiscoveredSessions(changedCandidates, adapters);
    const documents = await normalizeParsedSessions(parsed, {
      preferPiSessionIdFallback: config.launch.preferPiSessionIdFallback,
    });

    if (documents.length > 0) {
      upsertSessionDocuments(sessionsRepo, documents);
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

    return {
      discovered: discovered.length,
      changed: changedCandidates.length,
      indexed: documents.length,
      failed: failures.length,
      deletedSources,
      deletedSessions,
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
): void {
  sessionsRepo.upsertMany(documents);
}

function clearProviderState(db: Awaited<ReturnType<typeof openDatabase>>, provider?: ProviderId): void {
  if (!provider) {
    db.exec(`
      DELETE FROM parse_errors;
      DELETE FROM session_sources;
      DELETE FROM session_docs;
      DELETE FROM sessions;
      DELETE FROM sources;
    `);
    return;
  }

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
    deleteSessionDocs.run(provider);
    deleteSessions.run(provider);
    deleteParseErrors.run(provider);
    deleteSources.run(provider);
  })();
}

function cleanupOrphanSessions(db: Awaited<ReturnType<typeof openDatabase>>): number {
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
