import { describe, expect, it } from 'vitest';
import { buildEmptyStateMessage } from './BootstrapController.js';
import type { SyncSummary } from '../index/sync.js';

const SEMANTIC_HINT = ' Semantic search is off — run `recall setup` to enable natural-language matching (keyword search works now).';

function makeSummary(overrides: Partial<SyncSummary>): SyncSummary {
  return {
    discovered: 0,
    changed: 0,
    indexed: 0,
    failed: 0,
    deletedSources: 0,
    deletedSessions: 0,
    chunkedSessions: 0,
    chunks: 0,
    embeddedChunks: 0,
    reusedEmbeddings: 0,
    embeddingFailures: 0,
    semanticEnabled: true,
    semanticStatus: 'ready',
    ...overrides,
  };
}

describe('buildEmptyStateMessage', () => {
  it('shows bootstrap copy while first-run indexing is active', () => {
    expect(buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'syncing',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
    })).toBe('Indexing your local Claude, Codex, and pi sessions… results will appear automatically.');
  });

  it('explains when no local session files were discovered', () => {
    expect(buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: makeSummary({ discovered: 0 }),
    })).toBe('No local session files were found in the default Claude, Codex, or pi folders yet.');
  });

  it('suggests doctor when files were found but nothing indexed', () => {
    expect(buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: makeSummary({ discovered: 4, changed: 4, indexed: 0, failed: 4 }),
    })).toBe('Recall found session files, but indexing failed. Run `recall doctor` for details.');
  });

  it('does not override the normal empty state when sessions exist', () => {
    expect(buildEmptyStateMessage({
      totalSessions: 2,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
    })).toBeUndefined();
  });

  // semanticNeedsSetup tests
  it('appends semantic setup hint when semanticNeedsSetup is true and syncing', () => {
    const msg = buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'syncing',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
      semanticNeedsSetup: true,
    });
    expect(msg).toBe(`Indexing your local Claude, Codex, and pi sessions… results will appear automatically.${SEMANTIC_HINT}`);
  });

  it('appends semantic setup hint when semanticNeedsSetup is true and no files found', () => {
    const msg = buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: makeSummary({ discovered: 0 }),
      semanticNeedsSetup: true,
    });
    expect(msg).toBe(`No local session files were found in the default Claude, Codex, or pi folders yet.${SEMANTIC_HINT}`);
  });

  it('does NOT append semantic hint when semanticNeedsSetup is false', () => {
    const msg = buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'syncing',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
      semanticNeedsSetup: false,
    });
    expect(msg).toBe('Indexing your local Claude, Codex, and pi sessions… results will appear automatically.');
  });

  it('does NOT append semantic hint when totalSessions > 0 (returns undefined)', () => {
    const msg = buildEmptyStateMessage({
      totalSessions: 5,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
      semanticNeedsSetup: true,
    });
    expect(msg).toBeUndefined();
  });

  it('does NOT append semantic hint to error state (error message stays clean)', () => {
    const msg = buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'error',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: null,
      semanticNeedsSetup: true,
    });
    expect(msg).toBe('Initial indexing failed. Run `recall doctor` or `recall sync` to retry.');
  });
});
