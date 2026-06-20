import { describe, expect, it } from 'vitest';
import { shapeFtsResultRows } from './fts.js';
import { shapeFtsFirstResults, shapeHybridResults } from './service.js';
import type { FtsResultRow, KeywordSearchHit, VectorSearchHit } from './models.js';

function makeSeed(overrides: Partial<FtsResultRow> = {}): FtsResultRow {
  return {
    uid: overrides.uid ?? 'claude:1',
    provider: overrides.provider ?? 'claude',
    nativeId: overrides.nativeId ?? '1',
    title: overrides.title ?? 'Voyage embeddings in recall',
    repo: overrides.repo ?? 'recall',
    branch: overrides.branch ?? 'main',
    surface: overrides.surface ?? 'cli',
    cwd: overrides.cwd ?? '/Users/rutvik/rcode/recall',
    updatedAt: overrides.updatedAt ?? '2026-06-20T10:00:00.000Z',
    createdAt: overrides.createdAt ?? '2026-06-20T09:00:00.000Z',
    isSubagent: overrides.isSubagent ?? false,
    messageCount: overrides.messageCount ?? 12,
    models: overrides.models ?? ['opus-4.8'],
    resumeCmd: overrides.resumeCmd ?? "cd '/Users/rutvik/rcode/recall' && claude --resume '1'",
    forkCmd: overrides.forkCmd ?? null,
    firstPrompt: overrides.firstPrompt ?? 'Wire up VOYAGE_API_KEY for the recall search flow',
    body: overrides.body ?? 'We added Voyage embeddings and query parsing for the recall search flow.',
    ftsSnippet: overrides.ftsSnippet ?? '…added «Voyage» embeddings and query parsing…',
    bm25: overrides.bm25 ?? 0.25,
  };
}

describe('shapeFtsResultRows', () => {
  it('normalizes bm25 scores and assigns ranks', () => {
    const rows = shapeFtsResultRows([
      makeSeed({ uid: 'claude:1', nativeId: '1', bm25: 0.2 }),
      makeSeed({ uid: 'claude:2', nativeId: '2', bm25: 4.2 }),
    ]);

    expect(rows[0]?.keywordRank).toBe(1);
    expect(rows[1]?.keywordRank).toBe(2);
    expect((rows[0]?.keywordScore ?? 0) > (rows[1]?.keywordScore ?? 0)).toBe(true);
  });
});

describe('search result shaping', () => {
  it('ranks FTS-first hits with repo/title boosts and prefers FTS snippets', () => {
    const hits = shapeFtsResultRows([
      makeSeed({
        uid: 'claude:1',
        nativeId: '1',
        title: 'Wire VOYAGE_API_KEY into recall',
        bm25: 0.1,
      }),
      makeSeed({
        uid: 'codex:2',
        provider: 'codex',
        nativeId: '2',
        repo: 'codesift',
        title: 'MCP init failing',
        updatedAt: '2026-06-20T11:30:00.000Z',
        bm25: 0.8,
      }),
    ]);

    const results = shapeFtsFirstResults(hits, {
      query: {
        raw: 'VOYAGE_API_KEY',
        freeText: 'VOYAGE_API_KEY',
        filters: { includeSubagents: false },
      },
      currentRepo: 'recall',
      currentCwd: '/Users/rutvik/rcode/recall',
      limit: 5,
    });

    expect(results[0]?.uid).toBe('claude:1');
    expect(results[0]?.snippetSource).toBe('fts');
    expect(results).toHaveLength(2);
  });

  it('fuses keyword/vector candidates and filters subagents by default', () => {
    const keywordHits: KeywordSearchHit[] = shapeFtsResultRows([
      makeSeed({ uid: 'claude:1', nativeId: '1', bm25: 0.4 }),
      makeSeed({ uid: 'pi:subagent', provider: 'pi', nativeId: 'subagent', isSubagent: true, bm25: 0.1 }),
    ]);

    const vectorHits: VectorSearchHit[] = [
      {
        ...makeSeed({ uid: 'claude:1', nativeId: '1', bm25: 0.4 }),
        semanticSnippet: '…best matching semantic chunk…',
        vectorRank: 1,
        vectorScore: 0.92,
      },
      {
        ...makeSeed({ uid: 'pi:subagent', provider: 'pi', nativeId: 'subagent', isSubagent: true, bm25: 0.1 }),
        semanticSnippet: '…subagent chunk…',
        vectorRank: 2,
        vectorScore: 0.81,
      },
    ];

    const results = shapeHybridResults(keywordHits, vectorHits, {
      query: {
        raw: 'voyage embeddings',
        freeText: 'voyage embeddings',
        filters: { includeSubagents: false },
      },
      limit: 10,
      currentRepo: 'recall',
      currentCwd: '/Users/rutvik/rcode/recall',
    });

    expect(results.map((result) => result.uid)).toEqual(['claude:1']);
  });
});
