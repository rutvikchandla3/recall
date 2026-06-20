import { Box, Text } from 'ink';
import { truncateText } from '../layout.js';
import type { SyncStatus } from '../state.js';

export type FooterTone = 'info' | 'success' | 'warning' | 'error';

export interface FooterProps {
  message?: string | null;
  messageTone?: FooterTone;
  syncStatus: SyncStatus;
  width?: number;
}

const footerHint = 'type to search · ↑↓ move · Enter copy full command · Ctrl+G help · Ctrl+D/Ctrl+C quit';

export function Footer({ message, messageTone = 'info', syncStatus, width = 80 }: FooterProps) {
  const statusText = message ?? syncStatusLabel[syncStatus];
  const safeWidth = Math.max(20, Math.floor(width));
  const statusWidth = Math.min(statusText.length, safeWidth);
  const gutterWidth = statusWidth < safeWidth ? 1 : 0;
  const hintWidth = Math.max(0, safeWidth - statusWidth - gutterWidth);
  const statusColor = message ? toneColor[messageTone] : syncStatusColor[syncStatus];

  return (
    <Box width={safeWidth}>
      <Box width={hintWidth + gutterWidth}>
        <Text dimColor>{truncateText(footerHint, hintWidth)}</Text>
      </Box>
      <Box width={statusWidth} justifyContent="flex-end">
        <Text color={statusColor}>{truncateText(statusText, statusWidth)}</Text>
      </Box>
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
