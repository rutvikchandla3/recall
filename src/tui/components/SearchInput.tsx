import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import type { SearchStatus } from '../state.js';
import { formatActiveFilters, type ParsedSearchQuery } from '../../search/parseQuery.js';
import { truncateText } from '../layout.js';
import { applyEditableInputEvent, clampCursor } from '../input.js';

export interface SearchInputProps {
  query: string;
  parsedQuery: ParsedSearchQuery;
  status: SearchStatus;
  onChange: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  width?: number;
}

interface InkKeyLike {
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  escape?: boolean;
  home?: boolean;
  end?: boolean;
}

export function SearchInput({
  query,
  parsedQuery,
  status,
  onChange,
  placeholder = 'Search sessions…',
  focus = true,
  width = 80,
}: SearchInputProps) {
  const [cursor, setCursor] = useState(query.length);
  const filters = parsedQuery.tokens.length > 0
    ? parsedQuery.tokens.map((token) => token.raw)
    : formatActiveFilters(parsedQuery.filters);
  const helperText = filters.length > 0
    ? `filters: ${filters.join(' · ')}`
    : 'inline filters: provider:, repo:, branch:, surface:, since:, until:, include:subagents';
  const maxHelperWidth = Math.max(24, width - 10);
  const statusWidth = statusLabel[status].length + 2;
  const inputWidth = Math.max(12, width - statusWidth - 8);
  const display = useMemo(() => makeDisplay(query, cursor, inputWidth, placeholder, focus), [cursor, focus, inputWidth, placeholder, query]);

  useEffect(() => {
    setCursor((current) => clampCursor(current, query.length));
  }, [query]);

  useInput((input: string, key: InkKeyLike) => {
    const nextState = applyEditableInputEvent(
      { value: query, cursor },
      { input, key },
    );

    if (!nextState) {
      return;
    }

    if (nextState.value !== query) {
      onChange(nextState.value);
    }

    if (nextState.cursor !== cursor || nextState.value !== query) {
      setCursor(nextState.cursor);
    }
  }, { isActive: focus });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box alignItems="center">
        <Text color="cyanBright">🔎 </Text>
        <Box flexGrow={1}>
          <Text dimColor={query.length === 0}>{display.beforeCursor}</Text>
          <Text inverse={focus}>{display.cursorGlyph}</Text>
          <Text dimColor={query.length === 0}>{display.afterCursor}</Text>
        </Box>
        <Box marginLeft={1}>
          <Text color={statusColor[status]}>{statusLabel[status]}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{truncateText(helperText, maxHelperWidth)}</Text>
      </Box>
      {parsedQuery.warnings.length > 0 ? (
        <Box marginTop={1}>
          <Text color="yellow">{truncateText(parsedQuery.warnings.join(' · '), maxHelperWidth)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function makeDisplay(
  value: string,
  cursor: number,
  width: number,
  placeholder: string,
  focus: boolean,
): { beforeCursor: string; cursorGlyph: string; afterCursor: string } {
  if (value.length === 0) {
    const placeholderText = truncateText(placeholder, Math.max(1, width));
    if (!focus) {
      return {
        beforeCursor: placeholderText,
        cursorGlyph: '',
        afterCursor: '',
      };
    }

    return {
      beforeCursor: '',
      cursorGlyph: placeholderText[0] ?? ' ',
      afterCursor: placeholderText.slice(1),
    };
  }

  const clampedCursor = clampCursor(cursor, value.length);
  const available = Math.max(1, width - 1);
  let start = Math.max(0, clampedCursor - Math.floor(available * 0.6));
  let end = Math.min(value.length, start + available);

  if (end - start < available) {
    start = Math.max(0, end - available);
  }

  const visible = value.slice(start, end);
  const cursorIndex = Math.min(visible.length, clampedCursor - start);
  const before = `${start > 0 ? '…' : ''}${visible.slice(0, cursorIndex)}`;
  const cursorGlyph = visible[cursorIndex] ?? ' ';
  const afterCore = visible.slice(Math.min(cursorIndex + 1, visible.length));
  const after = `${afterCore}${end < value.length ? '…' : ''}`;

  return {
    beforeCursor: before,
    cursorGlyph,
    afterCursor: after,
  };
}

const statusColor: Record<SearchStatus, string> = {
  idle: 'gray',
  loading: 'yellow',
  ready: 'green',
  error: 'red',
};

const statusLabel: Record<SearchStatus, string> = {
  idle: 'Idle',
  loading: 'Searching…',
  ready: 'Ready',
  error: 'Error',
};
