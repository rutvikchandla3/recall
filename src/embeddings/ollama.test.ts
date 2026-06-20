import { describe, expect, it } from 'vitest';
import { formatForEmbedding, normalizeOllamaBaseUrl } from './ollama.js';

describe('normalizeOllamaBaseUrl', () => {
  it('accepts Ollama hosts and API endpoints', () => {
    expect(normalizeOllamaBaseUrl('localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api/embed')).toBe('http://localhost:11434');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api')).toBe('http://localhost:11434');
  });
});

describe('formatForEmbedding', () => {
  it('uses QMD-compatible prefixes for local embeddinggemma', () => {
    expect(formatForEmbedding('find recall session', 'query', 'embeddinggemma')).toBe('task: search result | query: find recall session');
    expect(formatForEmbedding('chunk text', 'document', 'embeddinggemma')).toBe('title: none | text: chunk text');
  });
});
