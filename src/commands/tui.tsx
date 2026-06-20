import { render } from 'ink';
import { ensureConfigScaffoldFile } from '../core/config.js';
import { openDatabase, closeDatabase, createSessionsRepo } from '../db/index.js';
import { copyToClipboard } from '../launch/clipboard.js';
import { openTranscript } from '../launch/transcript.js';
import { validateLaunchTarget } from '../launch/validate.js';
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
  const sessionsRepo = createSessionsRepo(db);
  const totalSessionsRow = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sessions').get();
  const totalSessions = totalSessionsRow?.count ?? 0;
  const repoResolver = createRepoResolver();
  const currentCwd = process.cwd();
  const currentRepo = await repoResolver.resolve(currentCwd);
  const service = createSqliteSearchService(db);

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
      onResume={async (result) => {
        const validation = await validateLaunchTarget(result.provider, result.cwd);
        await copyToClipboard(result.resumeCmd);
        console.log(result.resumeCmd);
        if (validation.warnings.length > 0) {
          console.error(validation.warnings.join('; '));
        }
        process.exit(0);
      }}
      onFork={async (result) => {
        if (!result.forkCmd) {
          return 'Fork unsupported for this provider';
        }

        const validation = await validateLaunchTarget(result.provider, result.cwd);
        await copyToClipboard(result.forkCmd);
        console.log(result.forkCmd);
        if (validation.warnings.length > 0) {
          console.error(validation.warnings.join('; '));
        }
        process.exit(0);
      }}
      onCopyCommand={async (result) => {
        await copyToClipboard(result.resumeCmd);
        return 'Copied resume command to clipboard';
      }}
      onCopyId={async (result) => {
        await copyToClipboard(result.nativeId);
        return 'Session id copied';
      }}
      onTranscript={async (result) => {
        const document = sessionsRepo.getByUid(result.uid);
        if (!document) {
          return 'Transcript not found';
        }

        await openTranscript(document.session.transcriptPaths);
        return 'Transcript opened';
      }}
      resolveWarnings={(result) => {
        if (!result) {
          return [];
        }

        const warnings: string[] = [];
        if (result.cwd === '(unknown)') {
          warnings.push('cwd unknown');
        }
        if (!result.forkCmd) {
          warnings.push('fork unsupported');
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
