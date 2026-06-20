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
  onResume?(result: SearchResult): void | string | Promise<void | string>;
  onFork?(result: SearchResult): void | string | Promise<void | string>;
  onCopyCommand?(result: SearchResult): void | string | Promise<void | string>;
  onCopyId?(result: SearchResult): void | string | Promise<void | string>;
  onTranscript?(result: SearchResult): void | string | Promise<void | string>;
}
