import { Box, Text } from 'ink';
import type { SearchStatus, SyncStatus } from '../state.js';

export interface HeaderProps {
  resultCount: number;
  totalSessions?: number;
  searchStatus: SearchStatus;
  syncStatus: SyncStatus;
}

export function Header({ resultCount, totalSessions, searchStatus, syncStatus }: HeaderProps) {
  return (
    <Box justifyContent="space-between">
      <Text bold>recall</Text>
      <Text dimColor>
        {totalSessions ?? resultCount} sessions · {searchLabel[searchStatus]} · {syncLabel[syncStatus]}
      </Text>
    </Box>
  );
}

const searchLabel: Record<SearchStatus, string> = {
  idle: 'idle',
  loading: 'searching',
  ready: 'ready',
  error: 'search error',
};

const syncLabel: Record<SyncStatus, string> = {
  idle: 'sync idle',
  syncing: 'syncing',
  done: 'synced',
  error: 'sync error',
};
