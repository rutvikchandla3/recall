import type { ProviderId, TranscriptTurn } from '../domain/session.js';

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
const JSON_BLOB_PATTERN = /^\s*[\[{][\s\S]{200,}[\]}]\s*$/;
const ENV_ASSIGNMENT_PATTERN = /^[A-Z0-9_]{3,}=.+$/m;
const TOOL_TRANSCRIPT_PATTERN = /(Chunk ID:|Wall time:|Process exited with code|Original token count:|tool_use_id|tool_result|toolCallId)/i;
const PAGE_INSPECTOR_PATTERN = /(Page URL:|Target selector:|Node position:|Frame: top document)/i;

const STRIP_BLOCK_TAGS = [
  'permissions instructions',
  'collaboration_mode',
  'skills_instructions',
  'plugins_instructions',
  'apps_instructions',
  'environment_context',
  'local-command-caveat',
  'turn_aborted',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
  'local-command-stdout',
] as const;

const STRIP_INLINE_TAGS = [
  'command-name',
  'command-message',
  'command-args',
] as const;

const DEDUPE_LINE_THRESHOLD = 3;

export interface CleanTextOptions {
  provider?: ProviderId;
}

function stripTaggedBlocks(text: string): string {
  let next = text;

  for (const tag of STRIP_BLOCK_TAGS) {
    const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi');
    next = next.replace(pattern, ' ');
  }

  for (const tag of STRIP_INLINE_TAGS) {
    const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi');
    next = next.replace(pattern, ' ');
  }

  next = next.replace(/^# AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>/im, ' ');
  next = next.replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ');

  return next;
}

function stripProviderBoilerplate(text: string, provider?: ProviderId): string {
  let next = text;

  if (provider === 'codex' || provider === 'claude') {
    next = next.replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, ' ');
    next = next.replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, ' ');
    next = next.replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, ' ');
    next = next.replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/gi, ' ');
    next = next.replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/gi, ' ');
    next = next.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, ' ');
  }

  if (provider === 'codex') {
    next = next.replace(/# AGENTS\.md instructions for .*?(?=\n\n|$)/gi, ' ');
    next = next.replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, '');
    next = next.replace(/^In app browser:[\s\S]*?My request for Codex:\s*/i, '');
  }

  return next;
}

function collapseDuplicateLines(text: string): string {
  const lines = text.split('\n');
  const compacted: string[] = [];
  let previous: string | null = null;
  let repeats = 0;

  for (const line of lines) {
    if (line === previous) {
      repeats += 1;
      if (repeats >= DEDUPE_LINE_THRESHOLD) {
        continue;
      }
    } else {
      previous = line;
      repeats = 0;
    }

    compacted.push(line);
  }

  return compacted.join('\n');
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

export function stripFormattingForTitle(text: string): string {
  return normalizeWhitespace(
    stripTaggedBlocks(text)
      .replace(CODE_FENCE_PATTERN, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~>#-]+/g, ' '),
  );
}

export function cleanConversationText(text: string, options: CleanTextOptions = {}): string {
  let next = text;

  next = next.replace(ANSI_PATTERN, '');
  next = stripTaggedBlocks(next);
  next = stripProviderBoilerplate(next, options.provider);
  next = next.replace(/<[^>]+>/g, ' ');
  next = collapseDuplicateLines(next);

  return normalizeWhitespace(next);
}

export function isLikelyNoiseText(text: string, provider?: ProviderId): boolean {
  const cleaned = provider ? cleanConversationText(text, { provider }) : cleanConversationText(text);

  if (cleaned.length === 0) {
    return true;
  }

  if (JSON_BLOB_PATTERN.test(cleaned)) {
    return true;
  }

  if (TOOL_TRANSCRIPT_PATTERN.test(cleaned)) {
    return true;
  }

  if (PAGE_INSPECTOR_PATTERN.test(cleaned)) {
    return true;
  }

  if (cleaned.includes('Filesystem sandboxing defines which files can be read or written.')) {
    return true;
  }

  if (cleaned.includes('### Available skills') || cleaned.includes('## Skills')) {
    return true;
  }

  if (cleaned.includes('current_date') && cleaned.includes('workspace_roots')) {
    return true;
  }

  if (ENV_ASSIGNMENT_PATTERN.test(cleaned) && cleaned.length > 1000) {
    return true;
  }

  if (provider === 'codex' && cleaned.includes('Target selector:')) {
    return true;
  }

  return false;
}

export function cleanTurns(turns: TranscriptTurn[], provider: ProviderId): TranscriptTurn[] {
  const cleanedTurns: TranscriptTurn[] = [];

  for (const turn of turns) {
    const text = cleanConversationText(turn.text, { provider });
    if (text.length === 0 || isLikelyNoiseText(text, provider)) {
      continue;
    }

    const previous = cleanedTurns[cleanedTurns.length - 1];
    if (previous && previous.role === turn.role && previous.text === text) {
      continue;
    }

    cleanedTurns.push({
      ...turn,
      text,
    });
  }

  return cleanedTurns;
}
