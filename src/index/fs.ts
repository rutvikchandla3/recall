import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_NAMES = new Set(['.DS_Store']);
const SKIP_SUFFIXES = ['.lock', '.tmp', '.temp', '.swp', '.swo', '~'];
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);

export function shouldSkipFileSystemEntry(name: string): boolean {
  if (SKIP_NAMES.has(name)) {
    return true;
  }

  return SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export async function* walkFiles(root: string): AsyncGenerator<string> {
  let directory;

  try {
    directory = await opendir(root);
  } catch {
    return;
  }

  for await (const entry of directory) {
    if (SKIP_DIRECTORIES.has(entry.name) || shouldSkipFileSystemEntry(entry.name)) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

export async function statSafe(filePath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const details = await stat(filePath);
    return {
      size: details.size,
      mtimeMs: details.mtimeMs,
    };
  } catch {
    return null;
  }
}

export function fileStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}
