import { render } from 'ink';
import { ensureConfigScaffoldFile } from '../core/config.js';
import { openDatabase, closeDatabase } from '../db/index.js';
import { copyToClipboard } from '../launch/clipboard.js';
import { createRepoResolver } from '../index/normalize.js';
import { createSqliteSearchService } from '../search/sqlite.js';
import { BootstrapController } from '../tui/BootstrapController.js';

export interface TuiCommandOptions {
  query?: string;
  limit?: number;
}

export async function runTuiCommand(options: TuiCommandOptions = {}): Promise<void> {
  const { config } = await ensureConfigScaffoldFile();
  const db = await openDatabase({ runMigrations: true });
  const totalSessionsRow = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sessions').get();
  const totalSessions = totalSessionsRow?.count ?? 0;
  const repoResolver = createRepoResolver();
  const currentCwd = process.cwd();
  const currentRepo = await repoResolver.resolve(currentCwd);
  const service = createSqliteSearchService(db, { config });

  const app = render(
    <BootstrapController
      db={db}
      service={service}
      {...(options.query !== undefined ? { initialQuery: options.query } : {})}
      limit={options.limit ?? 20}
      currentCwd={currentCwd}
      currentRepo={currentRepo}
      initialTotalSessions={totalSessions}
      backgroundSyncOnLaunch={config.indexing.backgroundSyncOnLaunch}
      onCopyCommand={async (result) => {
        await copyToClipboard(result.resumeCmd);
        return 'Copied full command to clipboard';
      }}
      resolveWarnings={(result) => {
        if (!result) {
          return [];
        }

        const warnings: string[] = [];
        if (result.cwd === '(unknown)') {
          warnings.push('cwd unknown');
        }
        return warnings;
      }}
    />,
  );

  try {
    await app.waitUntilExit();
  } finally {
    closeDatabase(db);
  }
}
