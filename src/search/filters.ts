import type { QueryFilters } from '../domain/query.js';
import type { ProviderId, Surface } from '../domain/session.js';
import { resolveTemporalFilter } from './parseQuery.js';

export interface FilterableRecord {
  provider: ProviderId;
  repo: string | null;
  branch: string | null;
  surface: Surface;
  updatedAt: string;
  isSubagent: boolean;
  cwd?: string;
}

export interface ResolvedDateRange {
  since?: Date;
  until?: Date;
}

export function hasActiveFilters(filters: QueryFilters): boolean {
  return Boolean(
    filters.provider
      || filters.repo
      || filters.branch
      || filters.surface
      || filters.since
      || filters.until
      || filters.includeSubagents,
  );
}

export function resolveDateRange(filters: Pick<QueryFilters, 'since' | 'until'>, now = new Date()): ResolvedDateRange {
  const resolved: ResolvedDateRange = {};

  const sinceValue = filters.since ? resolveTemporalFilter(filters.since, 'since', now) : null;
  if (sinceValue) {
    resolved.since = new Date(sinceValue);
  }

  const untilValue = filters.until ? resolveTemporalFilter(filters.until, 'until', now) : null;
  if (untilValue) {
    resolved.until = new Date(untilValue);
  }

  return resolved;
}

export function matchesSearchFilters(
  record: FilterableRecord,
  filters: QueryFilters,
  now = new Date(),
): boolean {
  if (filters.provider && record.provider !== filters.provider) {
    return false;
  }

  if (filters.repo && record.repo !== filters.repo && !matchesCwdSegment(record.cwd, filters.repo)) {
    return false;
  }

  if (filters.branch && record.branch !== filters.branch) {
    return false;
  }

  if (filters.surface && record.surface !== filters.surface) {
    return false;
  }

  if (!filters.includeSubagents && record.isSubagent) {
    return false;
  }

  const updatedAt = new Date(record.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  const { since, until } = resolveDateRange(filters, now);
  if (since && updatedAt < since) {
    return false;
  }

  if (until && updatedAt > until) {
    return false;
  }

  return true;
}

function matchesCwdSegment(cwd: string | undefined, filterValue: string): boolean {
  if (!cwd) {
    return false;
  }

  return cwd.toLowerCase().includes(filterValue.toLowerCase());
}
