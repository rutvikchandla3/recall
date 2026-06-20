import { openDatabase, closeDatabase } from '../db/connection.js';
import type { SearchResult } from '../domain/result.js';
import { createRepoResolver } from '../index/normalize.js';
import { parseQuery } from '../search/parseQuery.js';
import { createSqliteSearchService } from '../search/sqlite.js';

export interface SearchCommandOptions {
  query: string;
  json?: boolean;
  limit?: number;
}

export async function runSearchCommand(options: SearchCommandOptions): Promise<void> {
  const db = await openDatabase({ runMigrations: true });

  try {
    const service = createSqliteSearchService(db);
    const repoResolver = createRepoResolver();
    const currentCwd = process.cwd();
    const currentRepo = await repoResolver.resolve(currentCwd);
    const parsed = parseQuery(options.query);
    const results = await service.search({
      query: parsed,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      currentCwd,
      currentRepo,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    printHumanResults(results);
  } finally {
    closeDatabase(db);
  }
}

function printHumanResults(results: readonly SearchResult[]): void {
  if (results.length === 0) {
    console.log('No matching sessions found.');
    return;
  }

  for (const [index, result] of results.entries()) {
    const meta = [result.provider, result.repo ?? '(no repo)', result.branch ?? result.surface, result.updatedAt].join(' · ');
    console.log(`${index + 1}. ${result.title}`);
    console.log(`   ${meta}`);
    console.log(`   ${result.snippet}`);
    console.log(`   ${result.resumeCmd}`);
    console.log('');
  }
}
