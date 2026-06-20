import { runSync } from '../index/sync.js';
import type { ProviderId } from '../domain/session.js';

export interface IndexCommandOptions {
  full?: boolean;
  provider?: ProviderId;
  quiet?: boolean;
}

export async function runIndexCommand(options: IndexCommandOptions = {}): Promise<void> {
  const summary = await runSync({
    ...(options.full !== undefined ? { full: options.full } : {}),
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
  });

  console.log(`Indexed ${summary.indexed} sessions from ${summary.changed}/${summary.discovered} discovered files (${summary.failed} failures, ${summary.deletedSources} deleted sources, ${summary.deletedSessions} deleted orphan sessions).`);
}
