import type { FtsResultRow, KeywordSearchHit } from './models.js';

export interface FtsQueryPlan {
  normalizedText: string;
  tokens: string[];
  exactishTerms: string[];
  matchExpression: string | null;
}

const splitPattern = /\s+/g;

export function buildFtsQueryPlan(freeText: string): FtsQueryPlan {
  const normalizedText = normalizeQueryText(freeText);
  const tokens = tokenizeSearchText(normalizedText);

  return {
    normalizedText,
    tokens,
    exactishTerms: extractExactishTerms(normalizedText),
    matchExpression: buildFtsMatchExpression(normalizedText),
  };
}

export function buildFtsMatchExpression(freeText: string): string | null {
  const tokens = tokenizeSearchText(normalizeQueryText(freeText));
  if (tokens.length === 0) {
    return null;
  }

  return tokens
    .map((token) => `"${escapeFtsPhrase(token)}"`)
    .join(' AND ');
}

export function tokenizeSearchText(freeText: string): string[] {
  const normalized = normalizeQueryText(freeText);
  if (!normalized) {
    return [];
  }

  const tokens: string[] = [];
  let index = 0;

  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized[index] ?? '')) {
      index += 1;
    }

    if (index >= normalized.length) {
      break;
    }

    const marker = normalized[index];
    if (marker === '"' || marker === "'") {
      const end = findClosingQuote(normalized, index + 1, marker);
      const value = normalized.slice(index + 1, normalized[end - 1] === marker ? end - 1 : end).trim();
      if (value) {
        tokens.push(value);
      }
      index = end;
      continue;
    }

    let end = index;
    while (end < normalized.length && !/\s/.test(normalized[end] ?? '')) {
      end += 1;
    }

    const value = normalized.slice(index, end).trim();
    if (value) {
      tokens.push(value);
    }
    index = end;
  }

  return tokens;
}

export function extractExactishTerms(freeText: string): string[] {
  const terms = tokenizeSearchText(freeText);
  const seen = new Set<string>();
  const exactish: string[] = [];

  for (const term of terms) {
    const normalized = term.trim();
    if (!normalized || normalized.length < 2) {
      continue;
    }

    const looksExactish = /[_./-]/.test(normalized)
      || /[a-z][A-Z]/.test(normalized)
      || /^[A-Z0-9_]+$/.test(normalized)
      || /\d/.test(normalized);

    if (!looksExactish) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      exactish.push(normalized);
    }
  }

  return exactish;
}

export function normalizeBm25Score(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return 1 / (1 + Math.max(0, score));
}

export function shapeFtsResultRows(rows: readonly FtsResultRow[]): KeywordSearchHit[] {
  return rows.map((row, index) => ({
    ...row,
    keywordRank: row.keywordRank ?? index + 1,
    keywordScore: row.keywordScore ?? normalizeBm25Score(row.bm25),
  }));
}

function normalizeQueryText(freeText: string): string {
  return freeText.replace(splitPattern, ' ').trim();
}

function escapeFtsPhrase(token: string): string {
  return token.replace(/"/g, '""');
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
