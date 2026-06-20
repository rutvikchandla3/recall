import { Box, Text } from 'ink';
import type { SyncStatus } from '../state.js';

export type FooterTone = 'info' | 'success' | 'warning' | 'error';

export interface FooterProps {
  message?: string | null;
  messageTone?: FooterTone;
  syncStatus: SyncStatus;
}

export function Footer({ message, messageTone = 'info', syncStatus }: FooterProps) {
  return (
    <Box justifyContent="space-between">
      <Text dimColor>type to search · ↑↓ move · Enter resume · Ctrl+F fork · Ctrl+Y copy command · Ctrl+T transcript · Ctrl+G help · Ctrl+C quit</Text>
      <Text color={message ? toneColor[messageTone] : syncStatusColor[syncStatus]}>{message ?? syncStatusLabel[syncStatus]}</Text>
    </Box>
  );
}

const toneColor: Record<FooterTone, string> = {
  info: 'cyanBright',
  success: 'greenBright',
  warning: 'yellowBright',
  error: 'redBright',
};

const syncStatusColor: Record<SyncStatus, string> = {
  idle: 'gray',
  syncing: 'yellow',
  done: 'green',
  error: 'red',
};

const syncStatusLabel: Record<SyncStatus, string> = {
  idle: 'Idle',
  syncing: 'Syncing…',
  done: 'Sync complete',
  error: 'Sync error',
};
