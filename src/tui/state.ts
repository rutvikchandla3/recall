import type { SearchResult } from '../domain/result.js';
import type { ParsedSearchQuery } from '../search/parseQuery.js';

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

export interface AppState {
  query: string;
  parsedQuery: ParsedSearchQuery;
  results: SearchResult[];
  selectedIndex: number;
  preview: SearchResult | null;
  searchStatus: SearchStatus;
  syncStatus: SyncStatus;
  helpOpen: boolean;
  footerMessage?: string | null;
  warning?: string | null;
  error?: string | null;
}

export interface TuiActionHandlers {
  onCopyCommand?(result: SearchResult): void | string | Promise<void | string>;
}
