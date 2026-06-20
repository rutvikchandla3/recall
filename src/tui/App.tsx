import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import type { SearchResult } from '../domain/result.js';
import type { SearchService } from '../search/types.js';
import { Footer, type FooterTone } from './components/Footer.js';
import { computeVisibleResultCount, PANE_CHROME_HEIGHT, RESULT_ROW_HEIGHT } from './layout.js';

interface InkKeyLike {
  escape: boolean;
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta: boolean;
}
import { Header } from './components/Header.js';
import { HelpModal } from './components/HelpModal.js';
import { PreviewPane } from './components/PreviewPane.js';
import { ResultList } from './components/ResultList.js';
import { SearchInput } from './components/SearchInput.js';
import { useSearch } from './hooks/useSearch.js';
import { useSelection } from './hooks/useSelection.js';
import type { SyncStatus, TuiActionHandlers } from './state.js';

export interface AppProps extends TuiActionHandlers {
  service: SearchService;
  initialQuery?: string;
  limit?: number;
  currentCwd?: string;
  currentRepo?: string | null;
  totalSessions?: number;
  syncStatus?: SyncStatus;
  warning?: string | null;
  emptyStateMessage?: string;
  refreshToken?: number;
  resolveWarnings?: (result: SearchResult | null) => readonly string[];
}

export function App(props: AppProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [footerMessage, setFooterMessage] = useState<string | null>(null);
  const [footerTone, setFooterTone] = useState<FooterTone>('info');
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 120;
  const rows = stdout.rows ?? 24;
  const maxVisibleResults = computeVisibleResultCount({
    rows,
    helpOpen,
    hasWarnings: Boolean(props.warning),
  });
  const searchLimit = Math.max(props.limit ?? 20, maxVisibleResults * 3);
  const paneHeight = maxVisibleResults * RESULT_ROW_HEIGHT + PANE_CHROME_HEIGHT;
  const search = useSearch({
    service: props.service,
    limit: searchLimit,
    ...(props.initialQuery !== undefined ? { initialQuery: props.initialQuery } : {}),
    ...(props.currentCwd ? { currentCwd: props.currentCwd } : {}),
    ...(props.currentRepo !== undefined ? { currentRepo: props.currentRepo } : {}),
    ...(props.refreshToken !== undefined ? { refreshToken: props.refreshToken } : {}),
  });
  const selection = useSelection(search.results);
  const previewWarnings = useMemo(() => {
    if (props.resolveWarnings) {
      return [...props.resolveWarnings(selection.selectedResult)];
    }

    return props.warning ? [props.warning] : [];
  }, [props.resolveWarnings, props.warning, selection.selectedResult]);

  useEffect(() => {
    if (search.error) {
      setFooterMessage(search.error);
      setFooterTone('error');
    }
  }, [search.error]);

  useInput((input: string, key: InkKeyLike) => {
    if (key.escape) {
      setHelpOpen(false);
      return;
    }

    if (key.ctrl && input === 'g') {
      setHelpOpen((current: boolean) => !current);
      return;
    }

    if (key.ctrl && input === 'd') {
      exit();
      return;
    }

    if (helpOpen) {
      return;
    }

    if (key.upArrow) {
      selection.movePrevious();
      return;
    }

    if (key.downArrow) {
      selection.moveNext();
      return;
    }

    if (key.return) {
      void runAction(props.onCopyCommand, selection.selectedResult, 'Copied full command to clipboard');
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        resultCount={search.results.length}
        {...(props.totalSessions !== undefined ? { totalSessions: props.totalSessions } : {})}
        searchStatus={search.status}
        syncStatus={props.syncStatus ?? 'idle'}
      />
      <Box marginTop={1}>
        <SearchInput
          query={search.query}
          parsedQuery={search.parsedQuery}
          status={search.status}
          onChange={search.setQuery}
          focus={!helpOpen}
          width={columns}
        />
      </Box>
      <Box marginTop={1} flexDirection="row">
        <Box flexGrow={2} marginRight={1}>
          <ResultList
            results={search.results}
            selectedIndex={selection.selectedIndex}
            maxVisibleItems={maxVisibleResults}
            width={Math.max(36, Math.floor(columns * 0.48))}
            height={paneHeight}
          />
        </Box>
        <Box flexGrow={3}>
          <PreviewPane
            result={selection.selectedResult}
            warnings={previewWarnings}
            width={Math.max(36, Math.floor(columns * 0.45))}
            height={paneHeight}
          />
        </Box>
      </Box>
      {search.results.length === 0 && search.status === 'ready' ? (
        <Box marginTop={1}>
          <Text dimColor>
            {props.emptyStateMessage
              ?? (search.query.trim().length === 0
                ? 'Start typing or browse recent sessions.'
                : 'No sessions matched the current query.')}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Footer message={footerMessage} messageTone={footerTone} syncStatus={props.syncStatus ?? 'idle'} width={columns} />
      </Box>
      <HelpModal open={helpOpen} />
    </Box>
  );

  async function runAction(
    handler: ((result: SearchResult) => void | string | Promise<void | string>) | undefined,
    result: SearchResult | null,
    fallbackMessage: string,
  ): Promise<void> {
    if (!result) {
      setFooterMessage('No result selected');
      setFooterTone('warning');
      return;
    }

    if (!handler) {
      setFooterMessage(fallbackMessage);
      setFooterTone('success');
      return;
    }

    try {
      const nextMessage = await handler(result);
      const resolvedMessage = typeof nextMessage === 'string' && nextMessage.length > 0 ? nextMessage : fallbackMessage;
      setFooterMessage(resolvedMessage);
      setFooterTone('success');
      setTimeout(() => {
        setFooterMessage((current) => current === resolvedMessage ? null : current);
      }, 2500);
    } catch (actionError) {
      setFooterMessage(actionError instanceof Error ? actionError.message : 'Action failed');
      setFooterTone('error');
    }
  }
}
