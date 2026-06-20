import { Box, Text } from 'ink';
import type { SearchResult } from '../../domain/result.js';
import { truncateText } from '../layout.js';

export interface PreviewPaneProps {
  result: SearchResult | null;
  warnings?: readonly string[];
  width?: number;
  height?: number;
}

export function PreviewPane({ result, warnings = [], width = 60, height }: PreviewPaneProps) {
  const lineWidth = Math.max(20, width - 4);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0} flexGrow={1} {...(height !== undefined ? { height } : {})}>
      <Text bold>Preview</Text>
      {!result ? (
        <Box marginTop={1}>
          <Text dimColor>Pick a result to inspect metadata and commands.</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={providerColor[result.provider]}>{result.provider}</Text>
            <Text dimColor> · </Text>
            <Text>{truncateText(result.repo ?? '(no repo)', Math.max(10, Math.floor(lineWidth / 3)))}</Text>
            <Text dimColor> · </Text>
            <Text>{truncateText(result.branch ?? result.surface, Math.max(8, Math.floor(lineWidth / 4)))}</Text>
          </Text>
          <Text dimColor>{truncateText(`${formatDate(result.updatedAt)} · ${result.messageCount} msgs · ${result.models.join(', ') || 'unknown model'}`, lineWidth)}</Text>
          <Text dimColor>Match ({result.snippetSource})</Text>
          <Text>{truncateText(result.snippet, lineWidth * 2)}</Text>
          <Text dimColor>Resume</Text>
          <Text>{truncateText(result.resumeCmd, lineWidth)}</Text>
          {result.forkCmd ? <Text dimColor>{truncateText(`Fork: ${result.forkCmd}`, lineWidth)}</Text> : null}
          {warnings.length > 0 ? warnings.slice(0, 2).map((warning) => (
            <Text key={warning} color="yellow">• {truncateText(warning, lineWidth)}</Text>
          )) : null}
        </Box>
      )}
    </Box>
  );
}

const providerColor = {
  claude: 'magentaBright',
  codex: 'blueBright',
  pi: 'greenBright',
} as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}
