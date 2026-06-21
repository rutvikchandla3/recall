import { useEffect, useMemo, useState } from 'react';
import { spawnBackgroundSync } from '../core/background-sync.js';
import type { SqliteDatabase } from '../db/types.js';
import type { SyncSummary } from '../index/sync.js';
import { App, type AppProps } from './App.js';
import type { SyncStatus } from './state.js';

export interface BootstrapControllerProps extends Omit<AppProps, 'emptyStateMessage' | 'refreshToken' | 'syncStatus' | 'totalSessions'> {
  db: SqliteDatabase;
  initialTotalSessions?: number;
  backgroundSyncOnLaunch?: boolean;
}

export function BootstrapController(props: BootstrapControllerProps) {
  const [totalSessions, setTotalSessions] = useState(props.initialTotalSessions ?? countIndexedSessions(props.db));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(props.backgroundSyncOnLaunch ? 'syncing' : 'idle');
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);

  useEffect(() => {
    if (!props.backgroundSyncOnLaunch) {
      return;
    }

    let handle;
    try {
      handle = spawnBackgroundSync();
    } catch {
      setSyncStatus('error');
      return;
    }

    let disposed = false;

    handle.result.then((summary) => {
      if (disposed) {
        return;
      }

      setLastSyncSummary(summary);
      setTotalSessions(countIndexedSessions(props.db));
      setSyncStatus('done');
      setRefreshToken((current) => current + 1);
    }).catch(() => {
      if (disposed) {
        return;
      }

      setSyncStatus('error');
    });

    return () => {
      disposed = true;
      handle.cancel();
    };
  }, [props.backgroundSyncOnLaunch, props.db]);

  const semanticNeedsSetup = lastSyncSummary !== null && lastSyncSummary.semanticEnabled === false;

  const emptyStateMessage = useMemo(
    () => buildEmptyStateMessage({
      totalSessions,
      syncStatus,
      backgroundSyncOnLaunch: props.backgroundSyncOnLaunch ?? false,
      lastSyncSummary,
      semanticNeedsSetup,
    }),
    [lastSyncSummary, props.backgroundSyncOnLaunch, syncStatus, totalSessions, semanticNeedsSetup],
  );

  return (
    <App
      {...props}
      totalSessions={totalSessions}
      syncStatus={syncStatus}
      refreshToken={refreshToken}
      {...(emptyStateMessage ? { emptyStateMessage } : {})}
    />
  );
}

const SEMANTIC_SETUP_HINT = ' Semantic search is off — run `recall setup` to enable natural-language matching (keyword search works now).';

export function buildEmptyStateMessage(input: {
  totalSessions: number;
  syncStatus: SyncStatus;
  backgroundSyncOnLaunch: boolean;
  lastSyncSummary: SyncSummary | null;
  semanticNeedsSetup?: boolean;
}): string | undefined {
  if (input.totalSessions > 0) {
    return undefined;
  }

  const hint = input.semanticNeedsSetup ? SEMANTIC_SETUP_HINT : '';

  if (input.syncStatus === 'syncing' && input.backgroundSyncOnLaunch) {
    return `Indexing your local Claude, Codex, and pi sessions… results will appear automatically.${hint}`;
  }

  if (input.syncStatus === 'error') {
    return 'Initial indexing failed. Run `recall doctor` or `recall sync` to retry.';
  }

  if (input.lastSyncSummary?.discovered === 0) {
    return `No local session files were found in the default Claude, Codex, or pi folders yet.${hint}`;
  }

  if (input.lastSyncSummary && input.lastSyncSummary.discovered > 0 && input.lastSyncSummary.indexed === 0 && input.lastSyncSummary.failed > 0) {
    return 'Recall found session files, but indexing failed. Run `recall doctor` for details.';
  }

  if (!input.backgroundSyncOnLaunch) {
    return `No indexed sessions yet. Run \`recall sync\` to build the local index.${hint}`;
  }

  return `No indexed sessions yet. Results will appear automatically after indexing finishes.${hint}`;
}

function countIndexedSessions(db: SqliteDatabase): number {
  const row = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sessions').get();
  return row?.count ?? 0;
}
