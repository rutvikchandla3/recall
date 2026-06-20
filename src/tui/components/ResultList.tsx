import { Box, Text } from 'ink';
import type { SearchResult } from '../../domain/result.js';
import { computeResultWindow, truncateText } from '../layout.js';

export interface ResultListProps {
  results: readonly SearchResult[];
  selectedIndex: number;
  maxVisibleItems?: number;
  width?: number;
  height?: number;
}

export function ResultList({ results, selectedIndex, maxVisibleItems = 6, width = 60, height }: ResultListProps) {
  const window = computeResultWindow(results.length, selectedIndex, maxVisibleItems);
  const visibleResults = results.slice(window.start, window.end);
  const providerWidth = 10;
  const gapWidth = 2;
  const contentWidth = Math.max(20, width - 4);
  const titleWidth = Math.max(12, contentWidth - providerWidth - gapWidth);
  const detailWidth = Math.max(18, contentWidth - providerWidth - gapWidth);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0} flexGrow={1} {...(height !== undefined ? { height } : {})}>
      <Box justifyContent="space-between">
        <Text bold>Results</Text>
        {results.length > 0 ? (
          <Text dimColor>
            selected {selectedIndex + 1}/{results.length}
            {results.length > visibleResults.length ? ` · showing ${window.start + 1}-${window.end}` : ''}
          </Text>
        ) : null}
      </Box>
      {results.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>No matches yet. Try a broader query or remove a filter.</Text>
        </Box>
      ) : (
        visibleResults.map((result, offset) => {
          const index = window.start + offset;
          const selected = index === selectedIndex;
          const title = truncateText(result.title, titleWidth);
          const details = truncateText(
            `${result.repo ?? '(no repo)'} · ${result.branch ?? result.surface} · ${formatRelativeTime(result.updatedAt)} · ${result.snippet}`,
            detailWidth,
          );

          return (
            <Box key={result.uid} marginTop={offset === 0 ? 1 : 0}>
              <Box width={providerWidth} flexShrink={0}>
                <Text color={providerColor[result.provider]}>{`[${result.provider}]`}</Text>
              </Box>
              <Box width={gapWidth} flexShrink={0}>
                <Text> </Text>
              </Box>
              <Box flexDirection="column" width={titleWidth} flexShrink={1}>
                <Text {...(selected ? { color: 'cyanBright' as const } : {})}>{title}</Text>
                <Text {...(selected ? { color: 'cyan' as const } : {})} dimColor={!selected}>{details}</Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

const providerColor = {
  claude: 'magentaBright',
  codex: 'blueBright',
  pi: 'greenBright',
} as const;

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const deltaMs = Math.max(0, Date.now() - timestamp);
  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) {
    return `${deltaDays}d ago`;
  }

  const deltaWeeks = Math.floor(deltaDays / 7);
  if (deltaWeeks < 5) {
    return `${deltaWeeks}w ago`;
  }

  return new Date(value).toISOString().slice(0, 10);
}
