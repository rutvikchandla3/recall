import { loadConfig, type RecallConfig } from '../core/config.js';
import { createSessionsRepo } from '../db/sessions-repo.js';
import type { SqliteDatabase } from '../db/types.js';
import type { SearchResult } from '../domain/result.js';
import { shapeFtsResultRows, buildFtsQueryPlan } from './fts.js';
import type { FtsResultRow } from './models.js';
import { shapeBrowseResults, shapeFtsFirstResults, shapeHybridResults } from './service.js';
import type { SearchRequest, SearchService } from './types.js';
import { searchVectorHits } from './vector.js';

interface SearchRow {
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
  ftsSnippet: string | null;
  bm25: number;
}

export interface SqliteSearchServiceOptions {
  browseLimit?: number;
  config?: RecallConfig;
}

export function createSqliteSearchService(
  db: SqliteDatabase,
  options: SqliteSearchServiceOptions = {},
): SearchService {
  const sessionsRepo = createSessionsRepo(db);
  let configPromise: Promise<RecallConfig> | null = options.config ? Promise.resolve(options.config) : null;
  function resolveConfig(): Promise<RecallConfig> {
    configPromise ??= loadConfig();
    return configPromise;
  }

  const ftsStatement = db.prepare<[string], SearchRow>(`
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
      snippet(session_fts, 2, '«', '»', '…', 18) AS ftsSnippet,
      bm25(session_fts, 5.0, 2.5, 1.0) AS bm25
    FROM session_fts
    JOIN session_docs d ON d.session_id = session_fts.rowid
    JOIN sessions s ON s.id = d.session_id
    WHERE session_fts MATCH ?
    ORDER BY bm25 ASC
    LIMIT 100
  `);

  return {
    async search(request: SearchRequest): Promise<SearchResult[]> {
      if (!request.query.freeText.trim()) {
        const browseCandidates = sessionsRepo.listRecent({
          limit: options.browseLimit ?? 500,
          includeSubagents: true,
        }).map(toSeedFromStored);

        return shapeBrowseResults(browseCandidates, request);
      }

      const queryPlan = buildFtsQueryPlan(request.query.freeText);
      if (!queryPlan.matchExpression) {
        return [];
      }

      const rows = ftsStatement.all(queryPlan.matchExpression);
      const hits = shapeFtsResultRows(rows.map(toFtsResultRow));
      const vectorHits = await searchVectorSafely(db, await resolveConfig(), request.query.freeText);

      if (vectorHits.length === 0) {
        return shapeFtsFirstResults(hits, request);
      }

      return shapeHybridResults(hits, vectorHits, request);
    },

    async recent(limit: number): Promise<SearchResult[]> {
      const rows = sessionsRepo.listRecent({
        limit,
        includeSubagents: false,
      }).map(toSeedFromStored);

      return shapeBrowseResults(rows, {
        query: {
          raw: '',
          freeText: '',
          filters: { includeSubagents: false },
        },
        limit,
      });
    },
  };
}

async function searchVectorSafely(db: SqliteDatabase, config: RecallConfig, freeText: string) {
  try {
    return await searchVectorHits(db, config, freeText, { limit: 100, candidateLimit: 200 });
  } catch {
    return [];
  }
}

function toFtsResultRow(row: SearchRow): FtsResultRow {
  return {
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
    ftsSnippet: row.ftsSnippet,
    bm25: row.bm25,
  };
}

function toSeedFromStored(document: Awaited<ReturnType<ReturnType<typeof createSessionsRepo>['listRecent']>>[number]): FtsResultRow {
  return {
    uid: document.session.uid,
    provider: document.session.provider,
    nativeId: document.session.nativeId,
    title: document.session.title,
    repo: document.session.repo,
    branch: document.session.branch,
    surface: document.session.surface,
    cwd: document.session.cwd,
    updatedAt: document.session.updatedAt,
    createdAt: document.session.createdAt,
    isSubagent: document.session.isSubagent,
    messageCount: document.session.messageCount,
    models: document.session.models,
    resumeCmd: document.session.resumeCmd,
    forkCmd: document.session.forkCmd,
    firstPrompt: document.session.firstPrompt,
    body: document.body,
    previewSnippet: document.body,
    previewSnippetSource: 'body',
    bm25: 1,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
