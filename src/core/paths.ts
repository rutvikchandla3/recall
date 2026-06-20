import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface ResolvedPaths {
  dataDir: string;
  configDir: string;
  dbPath: string;
  configPath: string;
  tempDir: string;
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

export function resolvePaths(input?: { dataDir?: string; configDir?: string }): ResolvedPaths {
  const dataDir = expandHome(input?.dataDir ?? defaultDataDir());
  const configDir = expandHome(input?.configDir ?? defaultConfigDir());

  return {
    dataDir,
    configDir,
    dbPath: path.join(dataDir, 'index.db'),
    configPath: path.join(configDir, 'config.json'),
    tempDir: path.join(dataDir, 'tmp'),
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 });
}
