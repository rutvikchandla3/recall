import type { ParsedQuery, SearchOptions } from '../domain/query.js';
import type { SearchResult } from '../domain/result.js';

export interface SearchRequest extends SearchOptions {
  query: ParsedQuery;
}

export interface SearchService {
  search(request: SearchRequest): Promise<SearchResult[]>;
  recent(limit: number): Promise<SearchResult[]>;
}
