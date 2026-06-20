export type ProviderId = 'claude' | 'codex' | 'pi';

export type Surface = 'cli' | 'ide' | 'desktop' | 'subagent' | 'cloud';

export type TranscriptRole = 'user' | 'assistant';

export interface TranscriptTurn {
  role: TranscriptRole;
  text: string;
  timestamp?: string;
  model?: string;
}

export interface ParsedSession {
  provider: ProviderId;
  nativeId: string;
  transcriptPaths: string[];
  cwd: string | null;
  branch: string | null;
  surface: Surface;
  title: string | null;
  titleSource: 'native' | null;
  firstPrompt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  models: string[];
  isSubagent: boolean;
  turns: TranscriptTurn[];
  rawBytes: number;
  warnings?: string[];
}

export interface Session {
  uid: string;
  provider: ProviderId;
  nativeId: string;
  surface: Surface;
  cwd: string;
  repo: string | null;
  branch: string | null;
  title: string;
  titleSource: 'native' | 'synthesized';
  firstPrompt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  models: string[];
  isSubagent: boolean;
  transcriptPaths: string[];
  resumeCmd: string;
  forkCmd: string | null;
  bytes: number;
}

export interface SessionDocument {
  session: Session;
  body: string;
  rawBodySha256: string;
  normalizeVersion: string;
  chunkVersion: string;
  indexedAt: string;
}

export interface ChunkRecord {
  sessionUid: string;
  ord: number;
  text: string;
  approxTokens: number;
  startChar: number;
  endChar: number;
  textSha256: string;
  embedSha256?: string;
  infoScore?: number;
}
