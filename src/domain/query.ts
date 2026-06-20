import type { ProviderId, Surface } from './session.js';

export interface QueryFilters {
  provider?: ProviderId;
  repo?: string;
  branch?: string;
  surface?: Surface;
  since?: string;
  until?: string;
  includeSubagents: boolean;
}

export interface ParsedQuery {
  raw: string;
  freeText: string;
  filters: QueryFilters;
}

export interface SearchOptions {
  limit?: number;
  currentCwd?: string;
  currentRepo?: string | null;
}
