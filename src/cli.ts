#!/usr/bin/env node
import { Command } from 'commander';
import type { ProviderId } from './domain/session.js';
import { runConfigCommand } from './commands/config.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runIndexCommand } from './commands/index.js';
import { runSearchCommand } from './commands/search.js';
import { runSetupCommand } from './commands/setup.js';
import { runSyncCommand } from './commands/sync.js';
import { runTuiCommand } from './commands/tui.js';

const program = new Command();

program
  .name('recall')
  .description('Unified natural-language search and resume for coding agent sessions')
  .argument('[query...]', 'optional initial query for the TUI')
  .action(async (queryParts?: string[]) => {
    const query = joinQuery(queryParts);
    await runTuiCommand(query ? { query } : {});
  });

program
  .command('index')
  .option('--full', 'force a full rebuild')
  .option('--provider <provider>', 'scope indexing to a single provider')
  .option('--quiet', 'suppress progress logging')
  .action(async (options: { full?: boolean; provider?: ProviderId; quiet?: boolean }) => {
    await runIndexCommand(options);
  });

program
  .command('sync')
  .option('--provider <provider>', 'scope sync to a single provider')
  .option('--quiet', 'suppress progress logging')
  .option('--json', 'print JSON output')
  .action(async (options: { provider?: ProviderId; quiet?: boolean; json?: boolean }) => {
    await runSyncCommand(options);
  });

program
  .command('search')
  .argument('<query...>', 'search query')
  .option('--json', 'print JSON output')
  .option('--limit <limit>', 'result limit', (value) => Number(value))
  .action(async (queryParts: string[], options: { json?: boolean; limit?: number }) => {
    const query = joinQuery(queryParts);
    if (!query) {
      throw new Error('A search query is required.');
    }

    await runSearchCommand({
      query,
      ...(options.json !== undefined ? { json: options.json } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
  });

program
  .command('setup')
  .description('Enable local semantic search (downloads the embedding model on first run)')
  .option('--yes', 'skip the download confirmation (CI/non-interactive)')
  .option('--refresh', 're-download even if cached (fixes a corrupt cache)')
  .option('--json', 'print JSON output')
  .action(async (opts: { yes?: boolean; refresh?: boolean; json?: boolean }) => {
    await runSetupCommand(opts);
  });

program
  .command('pull')
  .description('Alias for `recall setup` — download the local embedding model')
  .option('--yes', 'skip the download confirmation (CI/non-interactive)')
  .option('--refresh', 're-download even if cached (fixes a corrupt cache)')
  .option('--json', 'print JSON output')
  .action(async (opts: { yes?: boolean; refresh?: boolean; json?: boolean }) => {
    await runSetupCommand(opts);
  });

program
  .command('doctor')
  .action(async () => {
    await runDoctorCommand();
  });

program
  .command('config')
  .option('--json', 'print JSON output')
  .option('--edit', 'open the config file in $EDITOR')
  .action(async (options: { json?: boolean; edit?: boolean }) => {
    await runConfigCommand(options);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function joinQuery(parts: string[] | undefined): string | undefined {
  if (!parts || parts.length === 0) {
    return undefined;
  }

  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : undefined;
}
