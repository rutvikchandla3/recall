import type { FusedSearchCandidate, KeywordSearchHit, SearchResultSeed, VectorSearchHit } from './models.js';

export interface ReciprocalRankFusionOptions {
  k?: number;
}

const defaultRrfK = 60;

export function reciprocalRankContribution(rank: number, k = defaultRrfK): number {
  return 1 / (k + rank);
}

export function reciprocalRankFusion(
  rankedLists: ReadonlyArray<ReadonlyArray<{ uid: string; rank?: number }>>,
  options: ReciprocalRankFusionOptions = {},
): Map<string, number> {
  const k = options.k ?? defaultRrfK;
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const rank = item.rank ?? index + 1;
      scores.set(item.uid, (scores.get(item.uid) ?? 0) + reciprocalRankContribution(rank, k));
    });
  }

  return scores;
}

export function fuseSearchCandidates(
  keywordHits: readonly KeywordSearchHit[],
  vectorHits: readonly VectorSearchHit[] = [],
  options: ReciprocalRankFusionOptions = {},
): FusedSearchCandidate[] {
  const k = options.k ?? defaultRrfK;
  const fused = new Map<string, FusedSearchCandidate>();

  mergeRankedList(fused, keywordHits, 'keyword', k);
  mergeRankedList(fused, vectorHits, 'vector', k);

  return [...fused.values()].sort((left, right) => right.fusionScore - left.fusionScore);
}

function mergeRankedList(
  target: Map<string, FusedSearchCandidate>,
  hits: readonly SearchResultSeed[],
  branch: 'keyword' | 'vector',
  k: number,
): void {
  hits.forEach((hit, index) => {
    const branchRank = branch === 'keyword'
      ? hit.keywordRank ?? index + 1
      : hit.vectorRank ?? index + 1;
    const contribution = reciprocalRankContribution(branchRank, k);

    const existing = target.get(hit.uid);
    if (!existing) {
      target.set(hit.uid, {
        ...hit,
        fusionScore: contribution,
      });
      return;
    }

    target.set(hit.uid, mergeCandidate(existing, hit, contribution));
  });
}

function mergeCandidate(
  existing: FusedSearchCandidate,
  incoming: SearchResultSeed,
  contribution: number,
): FusedSearchCandidate {
  const merged: FusedSearchCandidate = {
    ...existing,
    fusionScore: existing.fusionScore + contribution,
  };

  if (!merged.firstPrompt && incoming.firstPrompt) {
    merged.firstPrompt = incoming.firstPrompt;
  }

  if (!merged.body && incoming.body) {
    merged.body = incoming.body;
  }

  if (!merged.previewSnippet && incoming.previewSnippet) {
    merged.previewSnippet = incoming.previewSnippet;
  }

  if (!merged.previewSnippetSource && incoming.previewSnippetSource) {
    merged.previewSnippetSource = incoming.previewSnippetSource;
  }

  if (!merged.ftsSnippet && incoming.ftsSnippet) {
    merged.ftsSnippet = incoming.ftsSnippet;
  }

  if (!merged.semanticSnippet && incoming.semanticSnippet) {
    merged.semanticSnippet = incoming.semanticSnippet;
  }

  if (merged.keywordRank === undefined && incoming.keywordRank !== undefined) {
    merged.keywordRank = incoming.keywordRank;
  }

  if (merged.vectorRank === undefined && incoming.vectorRank !== undefined) {
    merged.vectorRank = incoming.vectorRank;
  }

  if (merged.keywordScore === undefined && incoming.keywordScore !== undefined) {
    merged.keywordScore = incoming.keywordScore;
  }

  if (merged.vectorScore === undefined && incoming.vectorScore !== undefined) {
    merged.vectorScore = incoming.vectorScore;
  }

  return merged;
}
