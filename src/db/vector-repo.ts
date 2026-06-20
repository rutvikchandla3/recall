import type { SqliteDatabase } from './types.js';
import { currentTimestamp } from './helpers.js';

export interface EmbeddingCacheKey {
  hash: string;
  model: string;
  dimensions: number;
}

export interface VectorRepo {
  ensureVectorTable(dimensions: number): void;
  getCachedEmbedding(key: EmbeddingCacheKey): Buffer | null;
  setCachedEmbedding(key: EmbeddingCacheKey, vector: Buffer): void;
  getCachedQueryEmbedding(key: EmbeddingCacheKey): Buffer | null;
  setCachedQueryEmbedding(key: EmbeddingCacheKey, vector: Buffer): void;
  upsertChunkEmbedding(chunkId: number, vector: Buffer): void;
  deleteChunkEmbedding(chunkId: number): void;
}

export function createVectorRepo(db: SqliteDatabase): VectorRepo {
  const getCachedEmbeddingStatement = db.prepare<EmbeddingCacheKey, { vector: Buffer } | undefined>(`
    SELECT vector
    FROM embedding_cache
    WHERE embed_sha256 = @hash
      AND model = @model
      AND dimensions = @dimensions
  `);

  const setCachedEmbeddingStatement = db.prepare<EmbeddingCacheKey & { vector: Buffer; created_at: string }>(`
    INSERT INTO embedding_cache(embed_sha256, model, dimensions, vector, created_at)
    VALUES(@hash, @model, @dimensions, @vector, @created_at)
    ON CONFLICT(embed_sha256, model, dimensions) DO UPDATE SET
      vector = excluded.vector,
      created_at = excluded.created_at
  `);

  const getCachedQueryEmbeddingStatement = db.prepare<EmbeddingCacheKey, { vector: Buffer } | undefined>(`
    SELECT vector
    FROM query_embedding_cache
    WHERE query_sha256 = @hash
      AND model = @model
      AND dimensions = @dimensions
  `);

  const setCachedQueryEmbeddingStatement = db.prepare<EmbeddingCacheKey & { vector: Buffer; created_at: string }>(`
    INSERT INTO query_embedding_cache(query_sha256, model, dimensions, vector, created_at)
    VALUES(@hash, @model, @dimensions, @vector, @created_at)
    ON CONFLICT(query_sha256, model, dimensions) DO UPDATE SET
      vector = excluded.vector,
      created_at = excluded.created_at
  `);

  let insertChunkEmbeddingStatement: { run(chunkId: bigint, vector: Buffer): unknown } | null = null;
  let deleteChunkEmbeddingStatement: { run(chunkId: bigint): unknown } | null = null;

  return {
    ensureVectorTable(dimensions) {
      ensureVectorTable(db, dimensions);
      insertChunkEmbeddingStatement = db.prepare('INSERT OR REPLACE INTO chunk_embeddings(chunk_id, embedding) VALUES(?, ?)');
      deleteChunkEmbeddingStatement = db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?');
    },
    getCachedEmbedding(key) {
      return getCachedEmbeddingStatement.get(key)?.vector ?? null;
    },
    setCachedEmbedding(key, vector) {
      setCachedEmbeddingStatement.run({ ...key, vector, created_at: currentTimestamp() });
    },
    getCachedQueryEmbedding(key) {
      return getCachedQueryEmbeddingStatement.get(key)?.vector ?? null;
    },
    setCachedQueryEmbedding(key, vector) {
      setCachedQueryEmbeddingStatement.run({ ...key, vector, created_at: currentTimestamp() });
    },
    upsertChunkEmbedding(chunkId, vector) {
      if (!insertChunkEmbeddingStatement) {
        throw new Error('Vector table has not been initialized.');
      }
      insertChunkEmbeddingStatement.run(BigInt(chunkId), vector);
    },
    deleteChunkEmbedding(chunkId) {
      if (!deleteChunkEmbeddingStatement) {
        throw new Error('Vector table has not been initialized.');
      }
      deleteChunkEmbeddingStatement.run(BigInt(chunkId));
    },
  };
}

export function ensureVectorTable(db: SqliteDatabase, dimensions: number): void {
  const safeDimensions = Math.trunc(dimensions);
  if (!Number.isFinite(safeDimensions) || safeDimensions <= 0 || safeDimensions > 100_000) {
    throw new Error(`Invalid vector dimensions: ${dimensions}`);
  }

  const existing = db.prepare<[string], { sql: string } | undefined>(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
  `).get('chunk_embeddings');

  if (existing) {
    const match = /embedding\s+float\[(\d+)\]/i.exec(existing.sql);
    const existingDimensions = match?.[1] ? Number(match[1]) : null;
    if (existingDimensions !== null && existingDimensions !== safeDimensions) {
      throw new Error(`Existing vector table uses ${existingDimensions} dimensions, but config expects ${safeDimensions}. Run recall index --full after changing dimensions.`);
    }
    return;
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${safeDimensions}]
    )
  `);
}
