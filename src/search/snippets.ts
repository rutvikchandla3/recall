import type { SnippetSource } from '../domain/result.js';
import { tokenizeSearchText } from './fts.js';

export interface SnippetSelectionInput {
  freeText: string;
  ftsSnippet?: string | null;
  semanticSnippet?: string | null;
  body?: string;
  previewSnippet?: string;
  previewSnippetSource?: SnippetSource;
  keywordRank?: number;
  vectorRank?: number;
  maxLength?: number;
}

export interface ResolvedSnippet {
  snippet: string;
  snippetSource: SnippetSource;
}

const defaultMaxLength = 220;

export function chooseSnippet(input: SnippetSelectionInput): ResolvedSnippet {
  if (input.previewSnippet) {
    return {
      snippet: normalizeSnippet(input.previewSnippet, input.maxLength),
      snippetSource: input.previewSnippetSource ?? 'body',
    };
  }

  const preferFts = Boolean(
    input.ftsSnippet
      && (input.keywordRank === undefined
        || input.vectorRank === undefined
        || input.keywordRank <= input.vectorRank + 10),
  );

  if (preferFts && input.ftsSnippet) {
    return {
      snippet: normalizeSnippet(input.ftsSnippet, input.maxLength),
      snippetSource: 'fts',
    };
  }

  if (input.semanticSnippet) {
    return {
      snippet: makeSnippet(input.semanticSnippet, input.freeText, input.maxLength),
      snippetSource: 'vector',
    };
  }

  if (input.body) {
    return {
      snippet: makeSnippet(input.body, input.freeText, input.maxLength),
      snippetSource: 'body',
    };
  }

  return {
    snippet: '',
    snippetSource: 'body',
  };
}

export function makeSnippet(text: string, freeText: string, maxLength = defaultMaxLength): string {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) {
    return '';
  }

  if (!freeText.trim()) {
    return truncateWithEllipsis(normalizedText, maxLength);
  }

  const lowerText = normalizedText.toLowerCase();
  const terms = tokenizeSearchText(freeText)
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 1);

  let anchor = -1;
  for (const term of terms) {
    anchor = lowerText.indexOf(term);
    if (anchor >= 0) {
      break;
    }
  }

  if (anchor < 0) {
    return truncateWithEllipsis(highlightTerms(normalizedText, freeText), maxLength);
  }

  const start = Math.max(0, anchor - Math.floor(maxLength / 3));
  const end = Math.min(normalizedText.length, start + maxLength);
  const excerpt = normalizedText.slice(start, end).trim();
  const withBoundary = start > 0 ? `…${excerpt}` : excerpt;
  const finalized = end < normalizedText.length ? `${withBoundary}…` : withBoundary;

  return highlightTerms(finalized, freeText);
}

export function highlightTerms(
  text: string,
  freeText: string,
  markers: { open: string; close: string } = { open: '«', close: '»' },
): string {
  const terms = tokenizeSearchText(freeText)
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .sort((left, right) => right.length - left.length);

  let result = text;
  for (const term of terms) {
    const pattern = new RegExp(escapeRegExp(term), 'gi');
    result = result.replace(pattern, (match) => `${markers.open}${match}${markers.close}`);
  }

  return result;
}

export function normalizeSnippet(snippet: string, maxLength = defaultMaxLength): string {
  return truncateWithEllipsis(collapseWhitespace(snippet), maxLength);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
