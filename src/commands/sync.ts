import { runSync } from '../index/sync.js';
import type { ProviderId } from '../domain/session.js';

export interface SyncCommandOptions {
  provider?: ProviderId;
  quiet?: boolean;
  json?: boolean;
}

export async function runSyncCommand(options: SyncCommandOptions = {}): Promise<void> {
  const summary = await runSync({
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...((options.json || options.quiet !== undefined) ? { quiet: options.json ? true : options.quiet } : {}),
  });

  if (options.json) {
    console.log(JSON.stringify(summary));
    return;
  }

  console.log(`Sync complete: ${summary.indexed} indexed / ${summary.changed} changed / ${summary.discovered} discovered / ${summary.failed} failures.`);
  console.log(`Semantic index: ${summary.chunkedSessions} sessions chunked, ${summary.chunks} chunks, ${summary.embeddedChunks} embedded (${summary.reusedEmbeddings} reused, ${summary.embeddingFailures} failures).`);
}
