import path from 'node:path';
import type { ParsedSession, TranscriptTurn } from '../domain/session.js';
import { buildResumeCommand } from '../launch/resume.js';
import { cleanConversationText, isLikelyNoiseText } from '../index/clean.js';
import { walkFiles } from '../index/fs.js';
import { streamJsonl } from '../index/parse.js';
import type { DiscoverOptions, ResumeCommandInput, SessionAdapter } from './types.js';
import {
  asString,
  decodeClaudeProjectPath,
  extractUuidFallback,
  inferSurface,
  isLikelySubagentPath,
  maxTimestamp,
  minTimestamp,
  statBytes,
} from './shared.js';

function extractClaudeContent(content: unknown, role: 'user' | 'assistant'): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const type = asString(record.type);

    if (role === 'assistant') {
      if (type === 'text') {
        const text = asString(record.text);
        if (text) {
          parts.push(text);
        }
      }

      continue;
    }

    if (type === 'text') {
      const text = asString(record.text);
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join('\n\n');
}

function createTurn(
  role: 'user' | 'assistant',
  text: string,
  timestamp: string | null,
  model?: string | null,
): TranscriptTurn | null {
  const cleaned = cleanConversationText(text, { provider: 'claude' });
  if (cleaned.length === 0 || isLikelyNoiseText(cleaned, 'claude')) {
    return null;
  }

  const turn: TranscriptTurn = {
    role,
    text: cleaned,
  };

  if (timestamp) {
    turn.timestamp = timestamp;
  }

  if (model) {
    turn.model = model;
  }

  return turn;
}

async function* discover(options: DiscoverOptions): AsyncIterable<string> {
  for (const root of options.roots) {
    for await (const filePath of walkFiles(root)) {
      if (!filePath.endsWith('.jsonl')) {
        continue;
      }

      const relative = path.relative(root, filePath);
      const segments = relative.split(path.sep);
      if (segments.length !== 2) {
        continue;
      }

      yield filePath;
    }
  }
}

async function parse(filePath: string): Promise<ParsedSession | null> {
  const warnings: string[] = [];
  const turns: TranscriptTurn[] = [];
  const models = new Set<string>();

  let nativeId = extractUuidFallback(filePath) ?? path.basename(filePath, '.jsonl');
  let cwd: string | null = null;
  let branch: string | null = null;
  let surface = inferSurface('cli');
  let title: string | null = null;
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let lastPrompt: string | null = null;

  const rawBytes = await statBytes(filePath);

  for await (const entry of streamJsonl<Record<string, unknown>>(filePath, {
    onError(issue) {
      warnings.push(`line ${issue.lineNumber}: ${issue.error.message}`);
    },
  })) {
    const record = entry.value;
    const recordTimestamp = typeof record.timestamp === 'string' ? record.timestamp : null;

    createdAt = minTimestamp(createdAt, recordTimestamp);
    updatedAt = maxTimestamp(updatedAt, recordTimestamp);

    nativeId = asString(record.sessionId) ?? nativeId;
    cwd = asString(record.cwd) ?? cwd;
    branch = asString(record.gitBranch) ?? branch;

    const inferredSurface = inferSurface(record.entrypoint, surface);
    if (inferredSurface !== 'cli') {
      surface = inferredSurface;
    }

    const recordType = asString(record.type);

    if (recordType === 'ai-title') {
      title = asString(record.aiTitle) ?? title;
      continue;
    }

    if (recordType === 'last-prompt') {
      lastPrompt = cleanConversationText(asString(record.lastPrompt) ?? '', { provider: 'claude' }) || lastPrompt;
      continue;
    }

    if (recordType !== 'user' && recordType !== 'assistant') {
      continue;
    }

    const message = record.message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    const role = asString((message as Record<string, unknown>).role);
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const model = asString((message as Record<string, unknown>).model);
    if (model) {
      models.add(model);
    }

    const text = extractClaudeContent((message as Record<string, unknown>).content, role);
    const turn = createTurn(role, text, recordTimestamp, model);
    if (turn) {
      turns.push(turn);
    }
  }

  if (!cwd) {
    cwd = await decodeClaudeProjectPath(path.basename(path.dirname(filePath)));
  }

  const firstPrompt = turns.find((turn) => turn.role === 'user')?.text ?? lastPrompt;
  const isSubagent = isLikelySubagentPath('claude', filePath) || (cwd ? isLikelySubagentPath('claude', cwd) : false);

  const session: ParsedSession = {
    provider: 'claude',
    nativeId,
    transcriptPaths: [filePath],
    cwd,
    branch,
    surface: isSubagent ? 'subagent' : surface,
    title,
    titleSource: title ? 'native' : null,
    firstPrompt: firstPrompt ?? null,
    createdAt,
    updatedAt,
    models: [...models],
    isSubagent,
    turns,
    rawBytes,
  };

  if (warnings.length > 0) {
    session.warnings = warnings;
  }

  return session;
}

function buildClaudeResumeCommand(input: ResumeCommandInput): string {
  return buildResumeCommand({
    provider: 'claude',
    nativeId: input.nativeId,
    cwd: input.cwd,
  });
}

export const claudeAdapter: SessionAdapter = {
  id: 'claude',
  discover,
  parse,
  buildResumeCmd: buildClaudeResumeCommand,
  buildForkCmd() {
    return null;
  },
};
