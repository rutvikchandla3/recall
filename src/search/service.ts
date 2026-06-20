import type { SearchResult } from '../domain/result.js';
import { matchesSearchFilters } from './filters.js';
import { fuseSearchCandidates } from './fuse.js';
import type { KeywordSearchHit, SearchResultSeed, VectorSearchHit } from './models.js';
import { rankBrowseCandidates, rankSearchCandidates } from './rank.js';
import type { SearchRequest } from './types.js';

export function shapeFtsFirstResults(
  hits: readonly KeywordSearchHit[],
  request: SearchRequest,
): SearchResult[] {
  const filtered = filterCandidates(hits, request);
  const ranked = request.query.freeText
    ? rankSearchCandidates(filtered, buildRankingContext(request))
    : rankBrowseCandidates(filtered, buildBrowseContext(request));

  return limitResults(ranked, request.limit);
}

export function shapeHybridResults(
  keywordHits: readonly KeywordSearchHit[],
  vectorHits: readonly VectorSearchHit[],
  request: SearchRequest,
): SearchResult[] {
  const fused = fuseSearchCandidates(keywordHits, vectorHits);
  const filtered = filterCandidates(fused, request);
  const ranked = request.query.freeText
    ? rankSearchCandidates(filtered, buildRankingContext(request))
    : rankBrowseCandidates(filtered, buildBrowseContext(request));

  return limitResults(ranked, request.limit);
}

export function shapeBrowseResults(
  candidates: readonly SearchResultSeed[],
  request: SearchRequest,
): SearchResult[] {
  const filtered = filterCandidates(candidates, request);
  return limitResults(rankBrowseCandidates(filtered, buildBrowseContext(request)), request.limit);
}

export function filterCandidates(
  candidates: readonly SearchResultSeed[],
  request: Pick<SearchRequest, 'query'>,
): SearchResultSeed[] {
  return candidates.filter((candidate) => matchesSearchFilters(candidate, request.query.filters));
}

function limitResults(results: readonly SearchResult[], limit: number | undefined): SearchResult[] {
  if (!limit || limit <= 0) {
    return [...results];
  }

  return results.slice(0, limit);
}

function buildRankingContext(request: SearchRequest) {
  return {
    freeText: request.query.freeText,
    ...(request.currentCwd ? { currentCwd: request.currentCwd } : {}),
    ...(request.currentRepo !== undefined ? { currentRepo: request.currentRepo } : {}),
    filters: request.query.filters,
  };
}

function buildBrowseContext(request: SearchRequest) {
  return {
    ...(request.currentCwd ? { currentCwd: request.currentCwd } : {}),
    ...(request.currentRepo !== undefined ? { currentRepo: request.currentRepo } : {}),
    filters: request.query.filters,
  };
}
