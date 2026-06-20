import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile } from '../core/child-process.js';
import type { ParsedSession, SessionDocument, TranscriptTurn } from '../domain/session.js';
import type { ResumeCommandTemplateInput } from '../launch/resume.js';
import { buildForkCommand, buildResumeCommand } from '../launch/resume.js';
import { cleanTurns, cleanConversationText, stripFormattingForTitle } from './clean.js';

const UNKNOWN_CWD = '(unknown)';
export const NORMALIZE_VERSION = 'fts-foundation-v1';
export const CHUNK_VERSION = 'semantic-chunks-v1';

export interface RepoResolver {
  resolve(cwd: string): Promise<string | null>;
}

export interface NormalizeSessionOptions {
  indexedAt?: string;
  normalizeVersion?: string;
  chunkVersion?: string;
  repoResolver?: RepoResolver;
  preferPiSessionIdFallback?: boolean;
}

function compareTimestamps(left?: string, right?: string): number {
  if (!left || !right) {
    return 0;
  }

  return left.localeCompare(right);
}

function firstTurnText(turns: TranscriptTurn[], role: 'user' | 'assistant'): string | null {
  return turns.find((turn) => turn.role === role)?.text ?? null;
}

export function synthesizeTitleFromTurns(turns: TranscriptTurn[]): string {
  const firstUserTurn = firstTurnText(turns, 'user');
  if (!firstUserTurn) {
    return '(untitled)';
  }

  let title = stripFormattingForTitle(firstUserTurn);
  title = title.replace(/^(task|hey|hi|hello)\b[:,\s-]*/i, '');
  title = title.replace(/^(can you|could you|please|help me)\b[:,\s-]*/i, '');
  title = title.trim();

  if (title.length === 0) {
    return '(untitled)';
  }

  const sentenceBreak = title.search(/[.!?](\s|$)/);
  if (sentenceBreak > 0) {
    title = title.slice(0, sentenceBreak + 1);
  }

  if (title.length > 80) {
    title = `${title.slice(0, 77).trimEnd()}...`;
  }

  return title || '(untitled)';
}

export function normalizeTitle(parsed: ParsedSession, turns: TranscriptTurn[]): { title: string; titleSource: 'native' | 'synthesized' } {
  const cleanedNativeTitle = cleanConversationText(parsed.title ?? '', { provider: parsed.provider });
  if (cleanedNativeTitle.length > 0) {
    return {
      title: cleanedNativeTitle,
      titleSource: 'native',
    };
  }

  return {
    title: synthesizeTitleFromTurns(turns),
    titleSource: 'synthesized',
  };
}

export function buildSessionBody(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
    .join('\n\n');
}

function hashSessionBody(input: {
  title: string;
  firstPrompt: string;
  body: string;
  updatedAt: string;
  normalizeVersion: string;
}): string {
  return createHash('sha256')
    .update(input.title)
    .update('\0')
    .update(input.firstPrompt)
    .update('\0')
    .update(input.body)
    .update('\0')
    .update(input.updatedAt)
    .update('\0')
    .update(input.normalizeVersion)
    .digest('hex');
}

function mergeTurns(turns: TranscriptTurn[]): TranscriptTurn[] {
  return [...turns].sort((left, right) => compareTimestamps(left.timestamp, right.timestamp));
}

function mergeWarnings(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const warnings = [...(left ?? []), ...(right ?? [])];
  return warnings.length > 0 ? [...new Set(warnings)] : undefined;
}

function mergeParsedSession(left: ParsedSession, right: ParsedSession): ParsedSession {
  const mergedTurns = mergeTurns([...left.turns, ...right.turns]);
  const mergedTranscriptPaths = [...new Set([...left.transcriptPaths, ...right.transcriptPaths])].sort();
  const mergedModels = [...new Set([...left.models, ...right.models])].sort();
  const warnings = mergeWarnings(left.warnings, right.warnings);

  const merged: ParsedSession = {
    provider: left.provider,
    nativeId: left.nativeId,
    transcriptPaths: mergedTranscriptPaths,
    cwd: left.cwd ?? right.cwd,
    branch: left.branch ?? right.branch,
    surface:
      left.surface === 'subagent' || right.surface === 'subagent'
        ? 'subagent'
        : left.surface !== 'cli'
          ? left.surface
          : right.surface,
    title: left.title ?? right.title,
    titleSource: left.titleSource ?? right.titleSource,
    firstPrompt: left.firstPrompt ?? right.firstPrompt,
    createdAt: !left.createdAt ? right.createdAt : !right.createdAt ? left.createdAt : left.createdAt <= right.createdAt ? left.createdAt : right.createdAt,
    updatedAt: !left.updatedAt ? right.updatedAt : !right.updatedAt ? left.updatedAt : left.updatedAt >= right.updatedAt ? left.updatedAt : right.updatedAt,
    models: mergedModels,
    isSubagent: left.isSubagent || right.isSubagent,
    turns: mergedTurns,
    rawBytes: left.rawBytes + right.rawBytes,
  };

  if (warnings) {
    merged.warnings = warnings;
  }

  return merged;
}

export function mergeParsedSessions(sessions: ParsedSession[]): ParsedSession[] {
  const grouped = new Map<string, ParsedSession>();

  for (const session of sessions) {
    const key = `${session.provider}:${session.nativeId}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...session,
        transcriptPaths: [...session.transcriptPaths],
        models: [...session.models],
        turns: mergeTurns(session.turns),
        ...(session.warnings ? { warnings: [...session.warnings] } : {}),
      });
      continue;
    }

    grouped.set(key, mergeParsedSession(existing, session));
  }

  return [...grouped.values()];
}

export function createRepoResolver(): RepoResolver {
  const cache = new Map<string, Promise<string | null>>();

  return {
    resolve(cwd: string): Promise<string | null> {
      if (cache.has(cwd)) {
        return cache.get(cwd) as Promise<string | null>;
      }

      const lookup = (async () => {
        if (cwd.length === 0 || cwd === UNKNOWN_CWD) {
          return null;
        }

        try {
          await access(cwd);
        } catch {
          return path.basename(cwd) || null;
        }

        const result = await execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
        if (result.exitCode === 0) {
          const repoRoot = result.stdout.trim();
          return repoRoot.length > 0 ? path.basename(repoRoot) : path.basename(cwd) || null;
        }

        return path.basename(cwd) || null;
      })();

      cache.set(cwd, lookup);
      return lookup;
    },
  };
}

export async function normalizeParsedSession(
  parsed: ParsedSession,
  options: NormalizeSessionOptions = {},
): Promise<SessionDocument> {
  const indexedAt = options.indexedAt ?? new Date().toISOString();
  const normalizeVersion = options.normalizeVersion ?? NORMALIZE_VERSION;
  const chunkVersion = options.chunkVersion ?? CHUNK_VERSION;
  const repoResolver = options.repoResolver ?? createRepoResolver();

  const turns = cleanTurns(parsed.turns, parsed.provider);
  const { title, titleSource } = normalizeTitle(parsed, turns);
  const cleanedFirstPrompt = cleanConversationText(parsed.firstPrompt ?? '', { provider: parsed.provider });
  const firstPrompt = cleanedFirstPrompt || firstTurnText(turns, 'user') || title;
  const body = buildSessionBody(turns);
  const cwd = parsed.cwd ?? UNKNOWN_CWD;
  const repo = await repoResolver.resolve(cwd);
  const createdAt = parsed.createdAt ?? turns[0]?.timestamp ?? indexedAt;
  const updatedAt = parsed.updatedAt ?? turns[turns.length - 1]?.timestamp ?? createdAt;
  const surface = parsed.isSubagent ? 'subagent' : parsed.surface;
  const models = [...new Set([...parsed.models, ...turns.map((turn) => turn.model).filter((model): model is string => Boolean(model))])];

  const commandInput: ResumeCommandTemplateInput = {
    provider: parsed.provider,
    nativeId: parsed.nativeId,
    cwd,
    ...(options.preferPiSessionIdFallback === undefined
      ? {}
      : { preferPiSessionIdFallback: options.preferPiSessionIdFallback }),
  };

  const session = {
    uid: `${parsed.provider}:${parsed.nativeId}`,
    provider: parsed.provider,
    nativeId: parsed.nativeId,
    surface,
    cwd,
    repo,
    branch: parsed.branch,
    title,
    titleSource,
    firstPrompt,
    createdAt,
    updatedAt,
    messageCount: turns.length,
    models,
    isSubagent: parsed.isSubagent,
    transcriptPaths: [...parsed.transcriptPaths].sort(),
    resumeCmd: buildResumeCommand(commandInput),
    forkCmd: buildForkCommand(commandInput),
    bytes: parsed.rawBytes,
  } as const;

  return {
    session,
    body,
    rawBodySha256: hashSessionBody({
      title,
      firstPrompt,
      body,
      updatedAt,
      normalizeVersion,
    }),
    normalizeVersion,
    chunkVersion,
    indexedAt,
  };
}

export async function normalizeParsedSessions(
  sessions: ParsedSession[],
  options: NormalizeSessionOptions = {},
): Promise<SessionDocument[]> {
  const mergedSessions = mergeParsedSessions(sessions);
  const repoResolver = options.repoResolver ?? createRepoResolver();

  return await Promise.all(
    mergedSessions.map((session) =>
      normalizeParsedSession(session, {
        ...options,
        repoResolver,
      }),
    ),
  );
}
