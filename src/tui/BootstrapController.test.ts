import { describe, expect, it } from 'vitest';
import { buildEmptyStateMessage } from './BootstrapController.js';

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
      lastSyncSummary: {
        discovered: 0,
        changed: 0,
        indexed: 0,
        failed: 0,
        deletedSources: 0,
        deletedSessions: 0,
      },
    })).toBe('No local session files were found in the default Claude, Codex, or pi folders yet.');
  });

  it('suggests doctor when files were found but nothing indexed', () => {
    expect(buildEmptyStateMessage({
      totalSessions: 0,
      syncStatus: 'done',
      backgroundSyncOnLaunch: true,
      lastSyncSummary: {
        discovered: 4,
        changed: 4,
        indexed: 0,
        failed: 4,
        deletedSources: 0,
        deletedSessions: 0,
      },
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
});
