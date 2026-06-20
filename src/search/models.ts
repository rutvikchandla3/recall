import type { SearchResult, SnippetSource } from '../domain/result.js';

export type SearchResultIdentity = Omit<
  SearchResult,
  'snippet' | 'snippetSource' | 'score' | 'keywordScore' | 'vectorScore'
>;

export interface SearchResultSeed extends SearchResultIdentity {
  firstPrompt?: string;
  body?: string;
  previewSnippet?: string;
  previewSnippetSource?: SnippetSource;
  ftsSnippet?: string | null;
  semanticSnippet?: string | null;
  keywordRank?: number;
  vectorRank?: number;
  keywordScore?: number;
  vectorScore?: number;
}

export interface KeywordSearchHit extends SearchResultSeed {
  keywordScore: number;
}

export interface VectorSearchHit extends SearchResultSeed {
  vectorScore: number;
}

export interface FusedSearchCandidate extends SearchResultSeed {
  fusionScore: number;
}

export interface FtsResultRow extends SearchResultSeed {
  bm25: number;
}

export interface VectorResultRow extends SearchResultSeed {
  similarity: number;
}
