import { runSync } from '../index/sync.js';
import type { ProviderId } from '../domain/session.js';

export interface SyncCommandOptions {
  provider?: ProviderId;
  quiet?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions = {}): Promise<void> {
  const summary = await runSync({
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.quiet !== undefined ? { quiet: options.quiet } : {}),
  });

  console.log(`Sync complete: ${summary.indexed} indexed / ${summary.changed} changed / ${summary.discovered} discovered / ${summary.failed} failures.`);
}
