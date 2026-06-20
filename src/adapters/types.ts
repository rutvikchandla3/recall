import type { ParsedSession, ProviderId } from '../domain/session.js';

export interface DiscoverOptions {
  roots: string[];
}

export interface ResumeCommandInput {
  nativeId: string;
  cwd: string;
}

export interface SessionAdapter {
  id: ProviderId;
  discover(options: DiscoverOptions): AsyncIterable<string>;
  parse(path: string): Promise<ParsedSession | ParsedSession[] | null>;
  buildResumeCmd(input: ResumeCommandInput): string;
  buildForkCmd?(input: ResumeCommandInput): string | null;
}
