import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { SearchResult } from '../../domain/result.js';
import { hasActiveFilters } from '../../search/filters.js';
import { parseQuery, type ParsedSearchQuery } from '../../search/parseQuery.js';
import type { SearchService } from '../../search/types.js';
import type { SearchStatus } from '../state.js';

export interface UseSearchOptions {
  service: SearchService;
  limit?: number;
  initialQuery?: string;
  currentCwd?: string;
  currentRepo?: string | null;
  debounceMs?: number;
  defaultIncludeSubagents?: boolean;
}

export interface UseSearchState {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  parsedQuery: ParsedSearchQuery;
  results: SearchResult[];
  status: SearchStatus;
  error: string | null;
}

export function useSearch(options: UseSearchOptions): UseSearchState {
  const [query, setQuery] = useState(options.initialQuery ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const parsedQuery = useMemo(
    () => parseQuery(
      query,
      options.defaultIncludeSubagents === undefined
        ? {}
        : { defaultIncludeSubagents: options.defaultIncludeSubagents },
    ),
    [options.defaultIncludeSubagents, query],
  );

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setStatus('loading');
    setError(null);

    const timer = setTimeout(() => {
      void runSearch(requestId);
    }, options.debounceMs ?? 120);

    return () => {
      clearTimeout(timer);
    };
  }, [options.currentCwd, options.currentRepo, options.debounceMs, options.limit, options.service, parsedQuery, query]);

  return {
    query,
    setQuery,
    parsedQuery,
    results,
    status,
    error,
  };

  async function runSearch(requestId: number): Promise<void> {
    try {
      const hasFilters = hasActiveFilters(parsedQuery.filters);
      const nextResults = !query.trim() && !hasFilters
        ? await options.service.recent(options.limit ?? 20)
        : await options.service.search({
          query: parsedQuery,
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.currentCwd ? { currentCwd: options.currentCwd } : {}),
          ...(options.currentRepo !== undefined ? { currentRepo: options.currentRepo } : {}),
        });

      if (requestId !== requestIdRef.current) {
        return;
      }

      setResults(nextResults);
      setStatus('ready');
    } catch (searchError) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setResults([]);
      setStatus('error');
      setError(searchError instanceof Error ? searchError.message : 'Search failed');
    }
  }
}
