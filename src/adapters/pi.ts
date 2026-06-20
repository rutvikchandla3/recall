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
  isLikelySubagentPath,
  maxTimestamp,
  minTimestamp,
  statBytes,
} from './shared.js';

function extractPiContent(content: unknown): string {
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
    if (asString(record.type) !== 'text') {
      continue;
    }

    const text = asString(record.text);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join('\n\n');
}

function createTurn(role: 'user' | 'assistant', text: string, timestamp: string | null, model?: string | null): TranscriptTurn | null {
  const cleaned = cleanConversationText(text, { provider: 'pi' });
  if (cleaned.length === 0 || isLikelyNoiseText(cleaned, 'pi')) {
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

function inferPiSubagent(filePath: string, cwd: string | null): boolean {
  return isLikelySubagentPath('pi', filePath) || (cwd ? isLikelySubagentPath('pi', cwd) : false);
}

async function* discover(options: DiscoverOptions): AsyncIterable<string> {
  for (const root of options.roots) {
    for await (const filePath of walkFiles(root)) {
      if (!filePath.endsWith('.jsonl')) {
        continue;
      }

      const baseName = path.basename(filePath);
      if (baseName === 'run-history.jsonl') {
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
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let activeModel: string | null = null;

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

    if (recordType === 'session') {
      nativeId = asString(record.id) ?? nativeId;
      cwd = asString(record.cwd) ?? cwd;
      createdAt = minTimestamp(createdAt, asString(record.timestamp));
      continue;
    }

    if (recordType === 'model_change') {
      activeModel = asString(record.modelId);
      if (activeModel) {
        models.add(activeModel);
      }
      continue;
    }

    if (recordType !== 'message') {
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

    const text = extractPiContent((message as Record<string, unknown>).content);
    const turn = createTurn(role, text, timestamp, activeModel);
    if (turn) {
      turns.push(turn);
    }
  }

  const isSubagent = inferPiSubagent(filePath, cwd);
  const firstPrompt = turns.find((turn) => turn.role === 'user')?.text ?? null;

  const session: ParsedSession = {
    provider: 'pi',
    nativeId,
    transcriptPaths: [filePath],
    cwd,
    branch: null,
    surface: isSubagent ? 'subagent' : 'cli',
    title: null,
    titleSource: null,
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

function buildPiResumeCommand(input: ResumeCommandInput): string {
  return buildResumeCommand({
    provider: 'pi',
    nativeId: input.nativeId,
    cwd: input.cwd,
  });
}

function buildPiForkCommand(input: ResumeCommandInput): string | null {
  return buildForkCommand({
    provider: 'pi',
    nativeId: input.nativeId,
    cwd: input.cwd,
  });
}

export const piAdapter: SessionAdapter = {
  id: 'pi',
  discover,
  parse,
  buildResumeCmd: buildPiResumeCommand,
  buildForkCmd: buildPiForkCommand,
};
