import { createHash } from 'node:crypto';
import type { RecallConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import { createChunksRepo, createVectorRepo, type ChunkInsertInput, type StoredChunkRecord } from '../db/index.js';
import type { StoredSessionDocument, SqliteDatabase } from '../db/types.js';
import { createEmbeddingClient, checkEmbeddingReadiness, embeddingModelCacheKey } from '../embeddings/client.js';
import { redactForEmbedding } from '../embeddings/redact.js';
import { embeddingToBuffer } from '../embeddings/vector.js';
import { chunkSessionText } from './chunk.js';
import { CHUNK_VERSION } from './normalize.js';

export type SemanticStatus = 'ready' | 'disabled' | 'not_ready' | 'unavailable';

export interface SemanticIndexSummary {
  chunkedSessions: number;
  chunks: number;
  embeddedChunks: number;
  reusedEmbeddings: number;
  embeddingFailures: number;
  semanticEnabled: boolean;
  semanticStatus: SemanticStatus;
  semanticMessage?: string;
  semanticSetup?: string[];
}

export interface SemanticProgressEvent {
  phase: 'chunk' | 'embed';
  current: number;
  total: number;
  detail?: string;
}

export interface SemanticIndexOptions {
  onProgress?: (event: SemanticProgressEvent) => void;
}

const DEFAULT_BACKFILL_LIMIT = 10_000;

export async function indexSemanticDocuments(
  db: SqliteDatabase,
  documents: readonly StoredSessionDocument[],
  config: RecallConfig,
  logger?: Logger,
  options: SemanticIndexOptions = {},
): Promise<SemanticIndexSummary> {
  const chunksRepo = createChunksRepo(db);
  const vectorRepo = createVectorRepo(db);
  const chunkVersion = semanticChunkVersion(config);
  const targets = uniqueDocuments([
    ...documents,
    ...chunksRepo.listDocumentsNeedingChunks(chunkVersion, DEFAULT_BACKFILL_LIMIT),
  ]);

  const summary: SemanticIndexSummary = {
    chunkedSessions: 0,
    chunks: 0,
    embeddedChunks: 0,
    reusedEmbeddings: 0,
    embeddingFailures: 0,
    semanticEnabled: false,
    semanticStatus: config.embeddings.enabled ? 'not_ready' : 'disabled',
    ...(config.embeddings.enabled ? {} : { semanticMessage: 'Embeddings are disabled in config.' }),
  };

  options.onProgress?.({ phase: 'chunk', current: 0, total: targets.length });
  for (const [index, document] of targets.entries()) {
    const chunks = prepareChunks(document, config);
    chunksRepo.replaceForSession(document.id, chunks);
    chunksRepo.updateSessionChunkVersion(document.id, chunkVersion);
    summary.chunkedSessions += 1;
    summary.chunks += chunks.length;
    options.onProgress?.({
      phase: 'chunk',
      current: index + 1,
      total: targets.length,
      detail: `${chunks.length} chunks · ${document.session.provider}`,
    });
  }

  if (!config.embeddings.enabled) {
    return summary;
  }

  try {
    vectorRepo.ensureVectorTable(config.embeddings.dimensions);
  } catch (error) {
    summary.semanticStatus = 'unavailable';
    summary.semanticMessage = `Vector table unavailable: ${error instanceof Error ? error.message : String(error)}`;
    summary.embeddingFailures += 1;
    return summary;
  }

  const readiness = await checkEmbeddingReadiness(config);
  summary.semanticEnabled = readiness.ok;
  summary.semanticStatus = readiness.ok ? 'ready' : 'not_ready';
  if (readiness.message) {
    summary.semanticMessage = readiness.message;
  }
  if (readiness.setup && readiness.setup.length > 0) {
    summary.semanticSetup = readiness.setup;
  }

  const pending = chunksRepo.listPending(DEFAULT_BACKFILL_LIMIT);
  const missing: StoredChunkRecord[] = [];
  let embeddingProgress = 0;

  options.onProgress?.({ phase: 'embed', current: 0, total: pending.length });
  for (const chunk of pending) {
    const cached = vectorRepo.getCachedEmbedding({
      hash: chunk.embedSha256 ?? chunk.textSha256,
      model: embeddingModelCacheKey(config),
      dimensions: config.embeddings.dimensions,
    });

    if (cached) {
      vectorRepo.upsertChunkEmbedding(chunk.id, cached);
      chunksRepo.markEmbedded(chunk.id);
      summary.reusedEmbeddings += 1;
      summary.embeddedChunks += 1;
      embeddingProgress += 1;
      options.onProgress?.({
        phase: 'embed',
        current: embeddingProgress,
        total: pending.length,
        detail: `${summary.embeddedChunks} embedded · ${summary.reusedEmbeddings} reused`,
      });
    } else {
      missing.push(chunk);
    }
  }

  if (!readiness.ok) {
    return summary;
  }

  if (missing.length === 0) {
    return summary;
  }

  const client = createEmbeddingClient(config);

  const batchSize = Math.max(1, Math.min(config.embeddings.batchSize, 128));
  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    const inputs = batch.map((chunk) => {
      const text = buildEmbeddingTextForStoredChunk(chunk);
      return config.embeddings.redactBeforeSend ? redactForEmbedding(text).text : text;
    });

    try {
      const embeddings = await client.embed(inputs, { inputType: 'document' });
      for (const [offset, embedding] of embeddings.entries()) {
        const chunk = batch[offset];
        if (!chunk) {
          continue;
        }

        const vector = embeddingToBuffer(embedding, config.embeddings.dimensions);
        const key = {
          hash: chunk.embedSha256 ?? chunk.textSha256,
          model: embeddingModelCacheKey(config),
          dimensions: config.embeddings.dimensions,
        };
        vectorRepo.setCachedEmbedding(key, vector);
        vectorRepo.upsertChunkEmbedding(chunk.id, vector);
        chunksRepo.markEmbedded(chunk.id);
        summary.embeddedChunks += 1;
        embeddingProgress += 1;
        options.onProgress?.({
          phase: 'embed',
          current: embeddingProgress,
          total: pending.length,
          detail: `${summary.embeddedChunks} embedded · ${summary.reusedEmbeddings} reused`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`Embedding batch failed: ${message}`);
      for (const chunk of batch) {
        chunksRepo.markFailed(chunk.id, message);
        summary.embeddingFailures += 1;
        embeddingProgress += 1;
      }
      options.onProgress?.({
        phase: 'embed',
        current: embeddingProgress,
        total: pending.length,
        detail: `${summary.embeddingFailures} failures`,
      });
    }
  }

  return summary;
}

function semanticChunkVersion(config: RecallConfig): string {
  return `${CHUNK_VERSION}:${embeddingModelCacheKey(config)}:${config.embeddings.dimensions}:${config.embeddings.redactBeforeSend ? 'redact' : 'raw'}`;
}

function prepareChunks(document: StoredSessionDocument, config: RecallConfig): ChunkInsertInput[] {
  return chunkSessionText(document.session.uid, document.body, {
    targetTokens: config.indexing.chunkTokens,
    overlapTokens: config.indexing.chunkOverlapTokens,
    maxChunks: config.indexing.maxChunksPerSession,
  }).map((chunk) => {
    const redacted = config.embeddings.redactBeforeSend ? redactForEmbedding(chunk.text).text : chunk.text;
    const embedSha256 = createHash('sha256')
      .update(embeddingModelCacheKey(config))
      .update('\0')
      .update(redacted)
      .digest('hex');

    return {
      ...chunk,
      embedSha256,
    };
  });
}

function buildEmbeddingTextForStoredChunk(chunk: StoredChunkRecord): string {
  return chunk.text;
}

function uniqueDocuments(documents: readonly StoredSessionDocument[]): StoredSessionDocument[] {
  const seen = new Set<number>();
  const unique: StoredSessionDocument[] = [];

  for (const document of documents) {
    if (seen.has(document.id)) {
      continue;
    }

    seen.add(document.id);
    unique.push(document);
  }

  return unique;
}
