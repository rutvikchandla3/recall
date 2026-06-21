import { access } from 'node:fs/promises';
import { defaultAdapters } from '../adapters/index.js';
import { loadConfig } from '../core/config.js';
import { openDatabase, closeDatabase, createParseErrorsRepo, createChunksRepo, ensureVectorTable } from '../db/index.js';
import { type ProviderId } from '../domain/session.js';
import { isCommandOnPath } from '../launch/validate.js';
import { discoverSessions } from '../index/discover.js';
import { checkEmbeddingReadiness, embeddingProviderLabel } from '../embeddings/client.js';

const providerBinary: Record<ProviderId, string> = {
  claude: 'claude',
  codex: 'codex',
  pi: 'pi',
};

export async function runDoctorCommand(): Promise<void> {
  const config = await loadConfig();

  console.log('Environment');
  console.log(`- config dir: ${config.paths.configDir}`);
  console.log(`- data dir: ${config.paths.dataDir}`);
  console.log(`- embeddings: ${config.embeddings.enabled ? 'enabled' : 'disabled'} · ${embeddingProviderLabel(config)} · ${config.embeddings.model} · ${config.embeddings.dimensions} dimensions`);
  if (config.embeddings.provider === 'voyage') {
    console.log(`- voyage key: ${config.embeddings.apiKey ? 'present' : 'missing'}`);
  } else if (config.embeddings.provider === 'llama') {
    console.log(`- model cache: ${config.paths.modelCacheDir}`);
  } else {
    console.log(`- ollama endpoint: ${config.embeddings.endpoint}`);
  }
  console.log('');

  console.log('Providers');
  for (const adapter of defaultAdapters) {
    const providerConfig = config.providers[adapter.id];
    const binary = providerBinary[adapter.id];
    const rootChecks = await Promise.all(providerConfig.roots.map(async (root) => ({ root, ok: await exists(root) })));
    const discoverable = providerConfig.enabled ? (await discoverSessions({ adapters: [adapter], config })).length : 0;
    const rootSummary = rootChecks.length === 0
      ? '(no roots)'
      : rootChecks.map((entry) => `${entry.ok ? 'OK' : 'WARN'} ${entry.root}`).join(', ');

    console.log(`- ${adapter.id}: ${providerConfig.enabled ? 'enabled' : 'disabled'} · binary ${isCommandOnPath(binary) ? 'OK' : 'WARN'} · ${rootSummary} · ${discoverable} files`);
  }
  console.log('');

  console.log('Embeddings');
  if (!config.embeddings.enabled) {
    console.log('- disabled in config');
  } else {
    if (config.embeddings.provider === 'ollama') {
      console.log(`- ollama binary: ${isCommandOnPath('ollama') ? 'OK' : 'WARN missing from PATH'}`);
    } else if (config.embeddings.provider === 'llama') {
      console.log('- backend: in-process llama.cpp (no daemon)');
      console.log(`- model cache: ${config.paths.modelCacheDir}`);
      console.log('- gpu: detected at first sync');
    }
    const readiness = await checkEmbeddingReadiness(config);
    console.log(`- setup: ${readiness.ok ? 'OK ready' : `WARN ${readiness.message ?? 'not ready'}`}`);
    if (!readiness.ok && readiness.setup && readiness.setup.length > 0) {
      for (const step of readiness.setup) {
        console.log(`  • ${step}`);
      }
    }
  }
  console.log('');

  console.log('Database');
  const db = await openDatabase({ runMigrations: true });
  try {
    const parseErrors = createParseErrorsRepo(db).listRecent(5);
    const sessionCountRow = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sessions').get();
    const sessionCount = sessionCountRow?.count ?? 0;
    const chunkCounts = createChunksRepo(db).countByStatus();
    console.log(`- OK opened database · ${sessionCount} indexed sessions`);
    console.log(`- chunks: ${chunkCounts.total} total · ${chunkCounts.embedded} embedded · ${chunkCounts.pending} pending · ${chunkCounts.failed} failed`);
    console.log(`- sqlite-vec: ${probeVectorBackend(db, config.embeddings.dimensions)}`);
    if (parseErrors.length > 0) {
      console.log('- recent parse errors:');
      for (const issue of parseErrors) {
        console.log(`  • [${issue.provider}] ${issue.path} :: ${issue.error}`);
      }
    } else {
      console.log('- OK no recent parse errors');
    }
  } finally {
    closeDatabase(db);
  }
}

function probeVectorBackend(db: Awaited<ReturnType<typeof openDatabase>>, dimensions: number): string {
  try {
    const version = db.prepare<[], { version: string }>('SELECT vec_version() AS version').get()?.version ?? 'unknown';
    ensureVectorTable(db, dimensions);
    return `OK ${version} · ${dimensions} dimensions`;
  } catch (error) {
    return `WARN unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
