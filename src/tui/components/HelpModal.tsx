import { Box, Text } from 'ink';

export interface HelpModalProps {
  open: boolean;
}

export function HelpModal({ open }: HelpModalProps) {
  if (!open) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0} marginTop={1}>
      <Text bold>Help</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Type to search · Enter: resume command · Ctrl+F: fork · Ctrl+Y: copy command · Ctrl+T: transcript</Text>
        <Text>↑/↓: move selection · Esc: close help · Ctrl+G: toggle help</Text>
        <Text dimColor>Filters: provider:, repo:, branch:, surface:, since:, until:, include:subagents</Text>
        <Text dimColor>Examples: repo:recall since:7d voyage embeddings</Text>
      </Box>
    </Box>
  );
}
