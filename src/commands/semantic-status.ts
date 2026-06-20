import type { SyncSummary } from '../index/sync.js';

export function printSemanticSearchHint(summary: SyncSummary): void {
  if (summary.semanticEnabled) {
    return;
  }

  const reason = summary.semanticMessage ?? describeSemanticStatus(summary.semanticStatus);
  console.log(`Semantic search not enabled: ${reason}`);

  if (summary.semanticSetup && summary.semanticSetup.length > 0) {
    console.log('Setup hint:');
    for (const step of summary.semanticSetup) {
      console.log(`  - ${step}`);
    }
  }
}

function describeSemanticStatus(status: SyncSummary['semanticStatus']): string {
  switch (status) {
    case 'disabled':
      return 'embeddings are disabled in config.';
    case 'not_ready':
      return 'the configured embedding provider is not ready.';
    case 'unavailable':
      return 'the local vector index is unavailable.';
    case 'ready':
      return 'no semantic vectors were produced.';
  }
}
