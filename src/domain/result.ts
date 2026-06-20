import type { ProviderId, Surface } from './session.js';

export type SnippetSource = 'fts' | 'vector' | 'body';

export interface SearchResult {
  uid: string;
  provider: ProviderId;
  nativeId: string;
  title: string;
  repo: string | null;
  branch: string | null;
  surface: Surface;
  cwd: string;
  updatedAt: string;
  createdAt: string;
  isSubagent: boolean;
  messageCount: number;
  models: string[];
  resumeCmd: string;
  forkCmd: string | null;
  snippet: string;
  snippetSource: SnippetSource;
  score: number;
  keywordScore?: number;
  vectorScore?: number;
}
