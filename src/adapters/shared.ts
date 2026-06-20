import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderId, Surface } from '../domain/session.js';

const UUID_FALLBACK_PATTERN = /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function normalizeTokenGroup(tokens: string[]): string {
  if (tokens.length === 0) {
    return '';
  }

  if (tokens[0] === '') {
    return `.${tokens.slice(1).join('-')}`;
  }

  return tokens.join('-');
}

async function exists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    seen.add(value);
  }

  return [...seen];
}

export function extractUuidFallback(filePath: string): string | null {
  const match = filePath.match(UUID_FALLBACK_PATTERN);
  return match?.[1] ?? null;
}

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    return ISO_TIMESTAMP_PATTERN.test(value) ? value : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return null;
}

export function minTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left <= right ? left : right;
}

export function maxTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

export async function statBytes(filePath: string): Promise<number> {
  try {
    const details = await stat(filePath);
    return details.size;
  } catch {
    return 0;
  }
}

export function inferSurface(value: unknown, fallback: Surface = 'cli'): Surface {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes('vscode') || normalized.includes('ide')) {
    return 'ide';
  }

  if (normalized.includes('desktop')) {
    return 'desktop';
  }

  if (normalized.includes('subagent')) {
    return 'subagent';
  }

  if (normalized.includes('cloud')) {
    return 'cloud';
  }

  return 'cli';
}

export function isLikelySubagentPath(provider: ProviderId, candidate: string): boolean {
  const normalized = candidate.toLowerCase();

  if (provider === 'codex') {
    return normalized.includes('thread_source":"subagent')
      || normalized.includes('/subagent/')
      || normalized.includes('codex desktop') && normalized.includes('subagent');
  }

  if (provider === 'pi') {
    return normalized.includes('agent-board/worktrees/view_')
      || normalized.includes('.pi-agent-agent-board-worktrees-view_')
      || normalized.includes('agent-view')
      || normalized.includes('hackerclaw');
  }

  return normalized.includes('agent-board/worktrees/view_') || normalized.includes('agent-view');
}

export async function decodeClaudeProjectPath(encodedDirectory: string): Promise<string | null> {
  const tokens = encodedDirectory.split('-');
  if (tokens.length === 0) {
    return null;
  }

  const cleanedTokens = tokens[0] === '' ? tokens.slice(1) : tokens;
  if (cleanedTokens.length === 0) {
    return null;
  }

  let current: string = path.sep;
  let index = 0;

  while (index < cleanedTokens.length) {
    const isRoot = current === path.sep;
    const directoryEntries = isRoot ? null : await safeReadDir(current);

    let matched: string | null = null;
    let matchedLength = 0;

    for (let length = cleanedTokens.length - index; length >= 1; length -= 1) {
      const segment = normalizeTokenGroup(cleanedTokens.slice(index, index + length));
      if (segment.length === 0) {
        continue;
      }

      if (isRoot) {
        const candidate = path.join(current, segment);
        if (await exists(candidate)) {
          matched = segment;
          matchedLength = length;
          break;
        }

        continue;
      }

      if (directoryEntries?.includes(segment)) {
        matched = segment;
        matchedLength = length;
        break;
      }
    }

    if (!matched) {
      const fallbackSegment = normalizeTokenGroup([cleanedTokens[index] ?? '']);
      if (fallbackSegment.length === 0) {
        return null;
      }

      current = path.join(current, fallbackSegment);
      index += 1;
      continue;
    }

    current = path.join(current, matched);
    index += matchedLength;
  }

  return current;
}

async function safeReadDir(directoryPath: string): Promise<string[] | null> {
  try {
    return await readdir(directoryPath);
  } catch {
    return null;
  }
}
