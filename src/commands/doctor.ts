import { access } from 'node:fs/promises';
import { defaultAdapters } from '../adapters/index.js';
import { loadConfig } from '../core/config.js';
import { openDatabase, closeDatabase, createParseErrorsRepo } from '../db/index.js';
import { type ProviderId } from '../domain/session.js';
import { isCommandOnPath } from '../launch/validate.js';
import { discoverSessions } from '../index/discover.js';

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
  console.log(`- voyage key: ${config.embeddings.apiKey ? 'present' : 'missing (semantic search disabled later)'}`);
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

  console.log('Database');
  const db = await openDatabase({ runMigrations: true });
  try {
    const parseErrors = createParseErrorsRepo(db).listRecent(5);
    const sessionCountRow = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sessions').get();
    const sessionCount = sessionCountRow?.count ?? 0;
    console.log(`- OK opened database · ${sessionCount} indexed sessions`);
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

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
