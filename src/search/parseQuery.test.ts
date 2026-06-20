import { describe, expect, it } from 'vitest';
import { parseQuery, resolveTemporalFilter } from './parseQuery.js';

const now = new Date('2026-06-20T12:00:00.000Z');

describe('parseQuery', () => {
  it('extracts inline filters and preserves free text', () => {
    const parsed = parseQuery(
      'voyage embeddings provider:claude repo:recall branch:"feature/search lane" surface:cli include:subagents since:3d until:2026-06-21',
      { now },
    );

    expect(parsed.freeText).toBe('voyage embeddings');
    expect(parsed.filters).toEqual({
      provider: 'claude',
      repo: 'recall',
      branch: 'feature/search lane',
      surface: 'cli',
      since: '2026-06-17T12:00:00.000Z',
      until: '2026-06-21T23:59:59.999Z',
      includeSubagents: true,
    });
    expect(parsed.tokens).toHaveLength(7);
    expect(parsed.warnings).toEqual([]);
  });

  it('does not parse filter-like text inside free-text quotes', () => {
    const parsed = parseQuery('"provider:claude" mcp init provider:pi', { now });

    expect(parsed.freeText).toBe('"provider:claude" mcp init');
    expect(parsed.filters.provider).toBe('pi');
  });

  it('keeps invalid filters in free text and reports warnings', () => {
    const parsed = parseQuery('provider:nope repo:recall', { now });

    expect(parsed.freeText).toBe('provider:nope');
    expect(parsed.filters.repo).toBe('recall');
    expect(parsed.filters.provider).toBeUndefined();
    expect(parsed.warnings).toContain('Ignored unknown provider filter: nope');
  });
});

describe('resolveTemporalFilter', () => {
  it('normalizes relative durations and date-only values', () => {
    expect(resolveTemporalFilter('12h', 'since', now)).toBe('2026-06-20T00:00:00.000Z');
    expect(resolveTemporalFilter('2026-06-01', 'since', now)).toBe('2026-06-01T00:00:00.000Z');
    expect(resolveTemporalFilter('2026-06-01', 'until', now)).toBe('2026-06-01T23:59:59.999Z');
  });
});
