import path from 'node:path';
import type { ParsedSession, TranscriptTurn } from '../domain/session.js';
import { buildForkCommand, buildResumeCommand } from '../launch/resume.js';
import { cleanConversationText, isLikelyNoiseText } from '../index/clean.js';
import { walkFiles } from '../index/fs.js';
import { streamJsonl } from '../index/parse.js';
import type { DiscoverOptions, ResumeCommandInput, SessionAdapter } from './types.js';
import {
  asString,
  extractUuidFallback,
  inferSurface,
  maxTimestamp,
  minTimestamp,
  statBytes,
} from './shared.js';

function classifyCodexSurface(source: unknown, isSubagent: boolean): 'cli' | 'ide' | 'subagent' {
  if (isSubagent) {
    return 'subagent';
  }

  if (typeof source === 'string') {
    return inferSurface(source) === 'ide' ? 'ide' : 'cli';
  }

  if (source && typeof source === 'object' && 'subagent' in source) {
    return 'subagent';
  }

  return 'cli';
}

function extractCodexContent(content: unknown): string {
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
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      const text = asString(record.text);
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join('\n\n');
}

function createTurn(role: 'user' | 'assistant', text: string, timestamp: string | null): TranscriptTurn | null {
  const cleaned = cleanConversationText(text, { provider: 'codex' });
  if (cleaned.length === 0 || isLikelyNoiseText(cleaned, 'codex')) {
    return null;
  }

  const turn: TranscriptTurn = {
    role,
    text: cleaned,
  };

  if (timestamp) {
    turn.timestamp = timestamp;
  }

  return turn;
}

async function* discover(options: DiscoverOptions): AsyncIterable<string> {
  for (const root of options.roots) {
    for await (const filePath of walkFiles(root)) {
      const name = path.basename(filePath);
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) {
        continue;
      }

      if (name === 'session_index.jsonl' || name.startsWith('logs') || name.endsWith('.sqlite')) {
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
  let title: string | null = null;
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let surface: 'cli' | 'ide' | 'subagent' = 'cli';
  let isSubagent = false;

  const rawBytes = await statBytes(filePath);

  for await (const entry of streamJsonl<Record<string, unknown>>(filePath, {
    onError(issue) {
      warnings.push(`line ${issue.lineNumber}: ${issue.error.message}`);
    },
  })) {
    const record = entry.value;
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null;

    createdAt = minTimestamp(createdAt, timestamp);
    updatedAt = maxTimestamp(updatedAt, timestamp);

    const recordType = asString(record.type);

    if (recordType === 'session_meta') {
      const payload = record.payload;
      if (!payload || typeof payload !== 'object') {
        continue;
      }

      const meta = payload as Record<string, unknown>;
      nativeId = asString(meta.id) ?? nativeId;
      cwd = asString(meta.cwd) ?? cwd;
      title = asString(meta.thread_name) ?? title;
      createdAt = minTimestamp(createdAt, asString(meta.timestamp));
      const hasSubagentSource = typeof meta.source === 'object' && meta.source !== null && 'subagent' in meta.source;
      isSubagent = isSubagent || asString(meta.thread_source) === 'subagent' || hasSubagentSource;
      surface = classifyCodexSurface(meta.source, isSubagent);
      continue;
    }

    if (recordType === 'event_msg') {
      const payload = record.payload;
      if (!payload || typeof payload !== 'object') {
        continue;
      }

      const eventPayload = payload as Record<string, unknown>;
      if (asString(eventPayload.type) === 'thread_name_updated') {
        title = asString(eventPayload.thread_name) ?? title;
      }

      continue;
    }

    if (recordType === 'turn_context') {
      const payload = record.payload;
      if (payload && typeof payload === 'object') {
        const model = asString((payload as Record<string, unknown>).model);
        if (model) {
          models.add(model);
        }
      }

      continue;
    }

    if (recordType !== 'response_item') {
      continue;
    }

    const payload = record.payload;
    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const response = payload as Record<string, unknown>;
    if (asString(response.type) !== 'message') {
      continue;
    }

    const role = asString(response.role);
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const text = extractCodexContent(response.content);
    const turn = createTurn(role, text, timestamp);
    if (turn) {
      turns.push(turn);
    }
  }

  const firstPrompt = turns.find((turn) => turn.role === 'user')?.text ?? null;

  const session: ParsedSession = {
    provider: 'codex',
    nativeId,
    transcriptPaths: [filePath],
    cwd,
    branch: null,
    surface,
    title,
    titleSource: title ? 'native' : null,
    firstPrompt,
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

function buildCodexResumeCommand(input: ResumeCommandInput): string {
  return buildResumeCommand({
    provider: 'codex',
    nativeId: input.nativeId,
    cwd: input.cwd,
  });
}

function buildCodexForkCommand(input: ResumeCommandInput): string | null {
  return buildForkCommand({
    provider: 'codex',
    nativeId: input.nativeId,
    cwd: input.cwd,
  });
}

export const codexAdapter: SessionAdapter = {
  id: 'codex',
  discover,
  parse,
  buildResumeCmd: buildCodexResumeCommand,
  buildForkCmd: buildCodexForkCommand,
};
