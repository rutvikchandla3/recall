import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface ResolvedPaths {
  dataDir: string;
  configDir: string;
  dbPath: string;
  configPath: string;
  tempDir: string;
  modelCacheDir: string;
}

export function expandHome(input: string): string {
  if (input === '~') {
    return homedir();
  }

  if (input.startsWith('~/')) {
    return path.join(homedir(), input.slice(2));
  }

  return input;
}

export function defaultDataDir(): string {
  return path.join(homedir(), '.local', 'share', 'recall');
}

export function defaultConfigDir(): string {
  return path.join(homedir(), '.config', 'recall');
}

export function defaultModelCacheDir(): string {
  const xdgCache = process.env['XDG_CACHE_HOME'];
  const cacheBase = xdgCache && xdgCache.trim().length > 0
    ? xdgCache.trim()
    : path.join(homedir(), '.cache');
  return path.join(cacheBase, 'recall', 'models');
}

export function resolvePaths(input?: { dataDir?: string; configDir?: string; modelCacheDir?: string }): ResolvedPaths {
  const dataDir = expandHome(input?.dataDir ?? defaultDataDir());
  const configDir = expandHome(input?.configDir ?? defaultConfigDir());
  const modelCacheDir = expandHome(input?.modelCacheDir ?? defaultModelCacheDir());

  return {
    dataDir,
    configDir,
    dbPath: path.join(dataDir, 'index.db'),
    configPath: path.join(configDir, 'config.json'),
    tempDir: path.join(dataDir, 'tmp'),
    modelCacheDir,
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
}
