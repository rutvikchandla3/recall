import { describe, expect, it } from 'vitest';
import { computeResultWindow, computeVisibleResultCount, truncateText } from './layout.js';

describe('computeVisibleResultCount', () => {
  it('caps visible results so the TUI stays within the viewport', () => {
    expect(computeVisibleResultCount({ rows: 24, helpOpen: false, hasWarnings: false })).toBeLessThanOrEqual(10);
    expect(computeVisibleResultCount({ rows: 24, helpOpen: false, hasWarnings: false })).toBeGreaterThanOrEqual(3);
  });

  it('reduces the visible list when help is open', () => {
    const normal = computeVisibleResultCount({ rows: 24, helpOpen: false, hasWarnings: false });
    const withHelp = computeVisibleResultCount({ rows: 24, helpOpen: true, hasWarnings: false });
    expect(withHelp).toBeLessThan(normal);
  });
});

describe('computeResultWindow', () => {
  it('keeps the selected result inside the visible window', () => {
    expect(computeResultWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(computeResultWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
    expect(computeResultWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
  });
});

describe('truncateText', () => {
  it('adds an ellipsis when content is too wide', () => {
    expect(truncateText('voyage embeddings are configured here', 12)).toBe('voyage embe…');
  });
});
