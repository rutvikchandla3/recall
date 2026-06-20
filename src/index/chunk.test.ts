import { describe, expect, it } from 'vitest';
import { chunkSessionText, estimateTokenCount } from './chunk.js';

describe('chunkSessionText', () => {
  it('chunks text with overlap and stable metadata', () => {
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const chunks = chunkSessionText('pi:test', text, {
      targetTokens: 20,
      overlapTokens: 5,
      maxChunks: 10,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.sessionUid).toBe('pi:test');
    expect(chunks[0]?.ord).toBe(0);
    expect(chunks[1]?.startChar).toBeLessThan(chunks[0]?.endChar ?? 0);
    expect(chunks.every((chunk) => chunk.textSha256.length === 64)).toBe(true);
  });

  it('caps long sessions while preserving first and last chunks', () => {
    const text = Array.from({ length: 400 }, (_, index) => `token${index}`).join(' ');
    const chunks = chunkSessionText('claude:test', text, {
      targetTokens: 10,
      overlapTokens: 0,
      maxChunks: 5,
    });

    expect(chunks).toHaveLength(5);
    expect(chunks[0]?.text).toContain('token0');
    expect(chunks[chunks.length - 1]?.text).toContain('token399');
    expect(chunks.map((chunk) => chunk.ord)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('estimateTokenCount', () => {
  it('returns zero for empty text and positive counts for content', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('voyage-code-3 embeddings')).toBeGreaterThan(0);
  });
});
