import type { ProviderId } from '../domain/session.js';

export interface ResumeCommandTemplateInput {
  provider: ProviderId;
  nativeId: string;
  cwd: string;
  preferPiSessionIdFallback?: boolean;
}

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildResumeCommand(input: ResumeCommandTemplateInput): string {
  const cwd = shellQuote(input.cwd);
  const sessionId = shellQuote(input.nativeId);

  switch (input.provider) {
    case 'claude':
      return `cd ${cwd} && claude --resume ${sessionId}`;
    case 'codex':
      return `cd ${cwd} && codex resume ${sessionId}`;
    case 'pi':
      return input.preferPiSessionIdFallback
        ? `cd ${cwd} && pi --session-id ${sessionId}`
        : `cd ${cwd} && pi --session ${sessionId}`;
  }
}

export function buildForkCommand(input: ResumeCommandTemplateInput): string | null {
  const cwd = shellQuote(input.cwd);
  const sessionId = shellQuote(input.nativeId);

  switch (input.provider) {
    case 'claude':
      return null;
    case 'codex':
      return `cd ${cwd} && codex fork ${sessionId}`;
    case 'pi':
      return `cd ${cwd} && pi --fork ${sessionId}`;
  }
}
