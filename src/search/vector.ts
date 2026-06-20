import { createHash } from 'node:crypto';
import type { RecallConfig } from '../core/config.js';
import { createVectorRepo, ensureVectorTable } from '../db/vector-repo.js';
import type { SqliteDatabase } from '../db/types.js';
import { redactForEmbedding } from '../embeddings/redact.js';
import { embeddingToBuffer } from '../embeddings/vector.js';
import { VoyageEmbeddingClient } from '../embeddings/voyage.js';
import type { VectorSearchHit } from './models.js';

interface VectorSearchRow {
  uid: string;
  provider: 'claude' | 'codex' | 'pi';
  nativeId: string;
  title: string;
  repo: string | null;
  branch: string | null;
  surface: 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';
  cwd: string;
  updatedAt: string;
  createdAt: string;
  isSubagent: number;
  messageCount: number;
  modelsJson: string;
  resumeCmd: string;
  forkCmd: string | null;
  firstPrompt: string;
  body: string;
  semanticSnippet: string;
  vectorRank: number;
  distance: number;
}

export interface VectorSearchOptions {
  limit?: number;
  candidateLimit?: number;
}

export async function searchVectorHits(
  db: SqliteDatabase,
  config: RecallConfig,
  freeText: string,
  options: VectorSearchOptions = {},
): Promise<VectorSearchHit[]> {
  const normalizedQuery = freeText.trim();
  if (!normalizedQuery || !config.embeddings.enabled || !config.embeddings.apiKey) {
    return [];
  }

  try {
    ensureVectorTable(db, config.embeddings.dimensions);
  } catch {
    return [];
  }

  if (countChunkEmbeddings(db) === 0) {
    return [];
  }

  const vector = await embedQueryWithCache(db, config, normalizedQuery);
  const candidateLimit = Math.max(options.limit ?? 100, options.candidateLimit ?? 200);
  const rows = runVectorQuery(db, vector, candidateLimit);

  return aggregateVectorRows(rows).slice(0, options.limit ?? 100);
}

function countChunkEmbeddings(db: SqliteDatabase): number {
  try {
    return db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM chunk_embeddings').get()?.count ?? 0;
  } catch {
    return 0;
  }
}

async function embedQueryWithCache(db: SqliteDatabase, config: RecallConfig, query: string): Promise<Buffer> {
  const vectorRepo = createVectorRepo(db);
  const outbound = config.embeddings.redactBeforeSend ? redactForEmbedding(query).text : query;
  const hash = createHash('sha256')
    .update(config.embeddings.model)
    .update('\0query\0')
    .update(outbound)
    .digest('hex');
  const key = {
    hash,
    model: config.embeddings.model,
    dimensions: config.embeddings.dimensions,
  };
  const cached = vectorRepo.getCachedQueryEmbedding(key);
  if (cached) {
    return cached;
  }

  const apiKey = config.embeddings.apiKey;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is required for semantic search.');
  }

  const client = new VoyageEmbeddingClient({
    apiKey,
    model: config.embeddings.model,
    dimensions: config.embeddings.dimensions,
  });
  const [embedding] = await client.embed([outbound], { inputType: 'query' });
  if (!embedding) {
    throw new Error('Voyage returned no query embedding.');
  }

  const vector = embeddingToBuffer(embedding, config.embeddings.dimensions);
  vectorRepo.setCachedQueryEmbedding(key, vector);
  return vector;
}

function runVectorQuery(db: SqliteDatabase, vector: Buffer, limit: number): VectorSearchRow[] {
  const statement = db.prepare<[Buffer, number], VectorSearchRow>(`
    WITH nearest AS (
      SELECT
        chunk_id,
        distance,
        row_number() OVER (ORDER BY distance ASC) AS vectorRank
      FROM chunk_embeddings
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance ASC
    )
    SELECT
      s.uid,
      s.provider,
      s.native_id AS nativeId,
      s.title,
      s.repo,
      s.branch,
      s.surface,
      s.cwd,
      s.updated_at AS updatedAt,
      s.created_at AS createdAt,
      s.is_subagent AS isSubagent,
      s.message_count AS messageCount,
      s.models_json AS modelsJson,
      s.resume_cmd AS resumeCmd,
      s.fork_cmd AS forkCmd,
      s.first_prompt AS firstPrompt,
      d.body,
      c.text AS semanticSnippet,
      nearest.vectorRank,
      nearest.distance
    FROM nearest
    JOIN chunks c ON c.id = nearest.chunk_id
    JOIN session_docs d ON d.session_id = c.session_id
    JOIN sessions s ON s.id = c.session_id
    ORDER BY nearest.distance ASC
  `);

  return statement.all(vector, Math.max(1, Math.trunc(limit)));
}

function aggregateVectorRows(rows: readonly VectorSearchRow[]): VectorSearchHit[] {
  const bestByUid = new Map<string, VectorSearchRow>();

  for (const row of rows) {
    const existing = bestByUid.get(row.uid);
    if (!existing || row.distance < existing.distance) {
      bestByUid.set(row.uid, row);
    }
  }

  return [...bestByUid.values()]
    .sort((left, right) => left.distance - right.distance)
    .map((row, index) => ({
      uid: row.uid,
      provider: row.provider,
      nativeId: row.nativeId,
      title: row.title,
      repo: row.repo,
      branch: row.branch,
      surface: row.surface,
      cwd: row.cwd,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      isSubagent: row.isSubagent !== 0,
      messageCount: row.messageCount,
      models: parseStringArray(row.modelsJson),
      resumeCmd: row.resumeCmd,
      forkCmd: row.forkCmd,
      firstPrompt: row.firstPrompt,
      body: row.body,
      semanticSnippet: row.semanticSnippet,
      vectorRank: index + 1,
      vectorScore: 1 / (1 + Math.max(0, row.distance)),
    }));
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
