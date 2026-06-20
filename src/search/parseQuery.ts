import type { ParsedQuery, QueryFilters } from '../domain/query.js';
import type { ProviderId, Surface } from '../domain/session.js';

export type QueryFilterKey = 'provider' | 'repo' | 'branch' | 'surface' | 'since' | 'until' | 'include';

export interface ParsedFilterToken {
  key: QueryFilterKey;
  raw: string;
  rawValue: string;
  start: number;
  end: number;
}

export interface ParsedSearchQuery extends ParsedQuery {
  tokens: ParsedFilterToken[];
  warnings: string[];
}

export interface QueryParserOptions {
  now?: Date;
  defaultIncludeSubagents?: boolean;
}

const filterKeys: QueryFilterKey[] = ['provider', 'repo', 'branch', 'surface', 'since', 'until', 'include'];
const providerValues = new Set<ProviderId>(['claude', 'codex', 'pi']);
const surfaceValues = new Set<Surface>(['cli', 'ide', 'desktop', 'subagent', 'cloud']);
const relativeDurationPattern = /^(\d+)([smhdwy])$/i;
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseQuery(raw: string, options: QueryParserOptions = {}): ParsedSearchQuery {
  const filters: QueryFilters = {
    includeSubagents: options.defaultIncludeSubagents ?? false,
  };
  const tokens: ParsedFilterToken[] = [];
  const warnings: string[] = [];

  let index = 0;

  while (index < raw.length) {
    const character = raw[index];

    if (character === '"' || character === "'") {
      index = findClosingQuote(raw, index + 1, character);
      continue;
    }

    if (!isFilterBoundary(raw, index)) {
      index += 1;
      continue;
    }

    const key = matchFilterKey(raw, index);
    if (!key) {
      index += 1;
      continue;
    }

    const value = readFilterValue(raw, index + key.length + 1);
    if (!value) {
      index += key.length + 1;
      continue;
    }

    const rawToken = raw.slice(index, value.end);
    const normalized = normalizeFilterValue(key, value.value, options.now);
    if (!normalized.valid) {
      warnings.push(normalized.warning ?? `Ignored invalid ${key} filter.`);
      index = value.end;
      continue;
    }

    applyFilter(filters, key, normalized.value);
    tokens.push({
      key,
      raw: rawToken,
      rawValue: value.value,
      start: index,
      end: value.end,
    });
    index = value.end;
  }

  return {
    raw,
    freeText: stripConsumedRanges(raw, tokens),
    filters,
    tokens,
    warnings,
  };
}

export function resolveTemporalFilter(input: string, kind: 'since' | 'until', now = new Date()): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const relativeMatch = trimmed.match(relativeDurationPattern);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2]?.toLowerCase();
    if (!unit) {
      return null;
    }

    const nowMs = now.getTime();
    const durationMs = amount * durationUnitMs(unit);

    return new Date(nowMs - durationMs).toISOString();
  }

  const dateOnlyMatch = trimmed.match(dateOnlyPattern);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const resolved = kind === 'since'
      ? new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    return Number.isNaN(resolved.getTime()) ? null : resolved.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatActiveFilters(filters: QueryFilters): string[] {
  const items: string[] = [];

  if (filters.provider) {
    items.push(`provider:${filters.provider}`);
  }

  if (filters.repo) {
    items.push(`repo:${filters.repo}`);
  }

  if (filters.branch) {
    items.push(`branch:${filters.branch}`);
  }

  if (filters.surface) {
    items.push(`surface:${filters.surface}`);
  }

  if (filters.since) {
    items.push(`since:${filters.since}`);
  }

  if (filters.until) {
    items.push(`until:${filters.until}`);
  }

  if (filters.includeSubagents) {
    items.push('include:subagents');
  }

  return items;
}

function stripConsumedRanges(raw: string, tokens: ParsedFilterToken[]): string {
  if (tokens.length === 0) {
    return normalizeWhitespace(raw);
  }

  const segments: string[] = [];
  let cursor = 0;

  for (const token of [...tokens].sort((left, right) => left.start - right.start)) {
    if (cursor < token.start) {
      segments.push(raw.slice(cursor, token.start));
    }

    cursor = token.end;
  }

  if (cursor < raw.length) {
    segments.push(raw.slice(cursor));
  }

  return normalizeWhitespace(segments.join(' '));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isFilterBoundary(raw: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  return /\s/.test(raw[index - 1] ?? '');
}

function matchFilterKey(raw: string, index: number): QueryFilterKey | null {
  for (const key of filterKeys) {
    if (raw.startsWith(`${key}:`, index)) {
      return key;
    }
  }

  return null;
}

function readFilterValue(raw: string, start: number): { value: string; end: number } | null {
  if (start >= raw.length) {
    return null;
  }

  const marker = raw[start];
  if (marker === '"' || marker === "'") {
    const end = findClosingQuote(raw, start + 1, marker);
    const closed = end > start && raw[end - 1] === marker;

    return {
      value: raw.slice(start + 1, closed ? end - 1 : end),
      end,
    };
  }

  let end = start;
  while (end < raw.length && !/\s/.test(raw[end] ?? '')) {
    end += 1;
  }

  if (end === start) {
    return null;
  }

  return {
    value: raw.slice(start, end),
    end,
  };
}

function findClosingQuote(raw: string, start: number, quote: '"' | "'"): number {
  let index = start;

  while (index < raw.length) {
    if (raw[index] === quote && raw[index - 1] !== '\\') {
      return index + 1;
    }

    index += 1;
  }

  return raw.length;
}

function normalizeFilterValue(
  key: QueryFilterKey,
  value: string,
  now = new Date(),
): { valid: true; value: string | boolean } | { valid: false; warning?: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, warning: `Ignored empty ${key} filter.` };
  }

  switch (key) {
    case 'provider':
      if (providerValues.has(trimmed as ProviderId)) {
        return { valid: true, value: trimmed };
      }
      return { valid: false, warning: `Ignored unknown provider filter: ${trimmed}` };
    case 'surface':
      if (surfaceValues.has(trimmed as Surface)) {
        return { valid: true, value: trimmed };
      }
      return { valid: false, warning: `Ignored unknown surface filter: ${trimmed}` };
    case 'since': {
      const resolved = resolveTemporalFilter(trimmed, 'since', now);
      return resolved
        ? { valid: true, value: resolved }
        : { valid: false, warning: `Ignored invalid since filter: ${trimmed}` };
    }
    case 'until': {
      const resolved = resolveTemporalFilter(trimmed, 'until', now);
      return resolved
        ? { valid: true, value: resolved }
        : { valid: false, warning: `Ignored invalid until filter: ${trimmed}` };
    }
    case 'include':
      return trimmed === 'subagents'
        ? { valid: true, value: true }
        : { valid: false, warning: `Ignored unknown include filter: ${trimmed}` };
    case 'repo':
    case 'branch':
      return { valid: true, value: trimmed };
  }
}

function applyFilter(filters: QueryFilters, key: QueryFilterKey, value: string | boolean): void {
  switch (key) {
    case 'provider':
      filters.provider = value as ProviderId;
      break;
    case 'repo':
      filters.repo = value as string;
      break;
    case 'branch':
      filters.branch = value as string;
      break;
    case 'surface':
      filters.surface = value as Surface;
      break;
    case 'since':
      filters.since = value as string;
      break;
    case 'until':
      filters.until = value as string;
      break;
    case 'include':
      filters.includeSubagents = value as boolean;
      break;
  }
}

function durationUnitMs(unit: string): number {
  switch (unit) {
    case 's':
      return 1_000;
    case 'm':
      return 60_000;
    case 'h':
      return 3_600_000;
    case 'd':
      return 86_400_000;
    case 'w':
      return 604_800_000;
    case 'y':
      return 31_536_000_000;
    default:
      return 0;
  }
}
