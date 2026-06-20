import { createHash } from 'node:crypto';
import type { ChunkRecord } from '../domain/session.js';

export interface ChunkSessionTextOptions {
  targetTokens: number;
  overlapTokens: number;
  maxChunks: number;
}

interface TokenUnit {
  start: number;
  end: number;
  approxTokens: number;
}

interface CandidateChunk extends ChunkRecord {
  sourceOrd: number;
}

const DEFAULT_FIRST_LAST_KEEP = 8;

export function chunkSessionText(
  sessionUid: string,
  text: string,
  options: ChunkSessionTextOptions,
): ChunkRecord[] {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }

  const targetTokens = Math.max(64, Math.trunc(options.targetTokens));
  const overlapTokens = Math.max(0, Math.min(Math.trunc(options.overlapTokens), Math.floor(targetTokens / 2)));
  const maxChunks = Math.max(1, Math.trunc(options.maxChunks));
  const units = tokenizeWithSpans(normalizedText);

  if (units.length === 0) {
    return [];
  }

  const candidates: CandidateChunk[] = [];
  let startIndex = 0;
  let sourceOrd = 0;

  while (startIndex < units.length) {
    let endIndex = startIndex;
    let tokenCount = 0;

    while (endIndex < units.length && (tokenCount < targetTokens || endIndex === startIndex)) {
      tokenCount += units[endIndex]?.approxTokens ?? 1;
      endIndex += 1;
    }

    const startChar = units[startIndex]?.start ?? 0;
    const endChar = units[endIndex - 1]?.end ?? normalizedText.length;
    const chunkText = normalizedText.slice(startChar, endChar).trim();

    if (chunkText.length > 0) {
      candidates.push(buildChunk(sessionUid, sourceOrd, chunkText, tokenCount, startChar, endChar));
      sourceOrd += 1;
    }

    if (endIndex >= units.length) {
      break;
    }

    startIndex = findOverlapStart(units, endIndex, overlapTokens);
    if (startIndex >= endIndex) {
      startIndex = endIndex;
    }
  }

  return capChunks(candidates, maxChunks).map((chunk, ord) => ({
    sessionUid: chunk.sessionUid,
    ord,
    text: chunk.text,
    approxTokens: chunk.approxTokens,
    startChar: chunk.startChar,
    endChar: chunk.endChar,
    textSha256: chunk.textSha256,
    ...(chunk.embedSha256 ? { embedSha256: chunk.embedSha256 } : {}),
    ...(chunk.infoScore !== undefined ? { infoScore: chunk.infoScore } : {}),
  }));
}

export function estimateTokenCount(text: string): number {
  const compact = text.trim();
  if (!compact) {
    return 0;
  }

  const lexicalTokens = compact.match(/[\p{L}\p{N}_-]+|[^\s]/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(Math.max(lexicalTokens, compact.length / 4)));
}

function tokenizeWithSpans(text: string): TokenUnit[] {
  const units: TokenUnit[] = [];
  const pattern = /\S+\s*/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    const nonWhitespace = value.trimEnd();
    units.push({
      start: match.index,
      end: match.index + value.length,
      approxTokens: estimateTokenCount(nonWhitespace),
    });
  }

  return units;
}

function findOverlapStart(units: readonly TokenUnit[], endIndex: number, overlapTokens: number): number {
  if (overlapTokens <= 0) {
    return endIndex;
  }

  let tokenCount = 0;
  let index = endIndex - 1;
  while (index > 0 && tokenCount < overlapTokens) {
    tokenCount += units[index]?.approxTokens ?? 1;
    index -= 1;
  }

  return Math.max(0, index + 1);
}

function buildChunk(
  sessionUid: string,
  sourceOrd: number,
  text: string,
  approxTokens: number,
  startChar: number,
  endChar: number,
): CandidateChunk {
  const infoScore = calculateInfoScore(text, approxTokens);
  return {
    sessionUid,
    ord: sourceOrd,
    sourceOrd,
    text,
    approxTokens,
    startChar,
    endChar,
    textSha256: createHash('sha256').update(text).digest('hex'),
    infoScore,
  };
}

function capChunks(chunks: readonly CandidateChunk[], maxChunks: number): CandidateChunk[] {
  if (chunks.length <= maxChunks) {
    return [...chunks];
  }

  const edgeKeep = Math.min(DEFAULT_FIRST_LAST_KEEP, Math.floor(maxChunks / 2));
  const first = chunks.slice(0, edgeKeep);
  const last = chunks.slice(Math.max(edgeKeep, chunks.length - edgeKeep));
  const used = new Set([...first, ...last].map((chunk) => chunk.sourceOrd));
  const remainingSlots = Math.max(0, maxChunks - used.size);

  const middle = chunks
    .filter((chunk) => !used.has(chunk.sourceOrd))
    .sort((left, right) => (right.infoScore ?? 0) - (left.infoScore ?? 0))
    .slice(0, remainingSlots);

  return [...first, ...middle, ...last]
    .sort((left, right) => left.sourceOrd - right.sourceOrd)
    .slice(0, maxChunks);
}

function calculateInfoScore(text: string, approxTokens: number): number {
  const terms = text.match(/[A-Za-z_][A-Za-z0-9_./:-]{2,}/g) ?? [];
  const uniqueTerms = new Set(terms.map((term) => term.toLowerCase()));
  const codeLikeTerms = terms.filter((term) => /[._/:=-]|[A-Z][a-z]+[A-Z]|[a-z]+[A-Z]/.test(term)).length;
  const roleMarkers = (text.match(/\b(User|Assistant):/g) ?? []).length;
  const filePaths = (text.match(/(?:^|\s)[\w./-]+\.(?:ts|tsx|js|jsx|json|md|sql|py|go|rs|css|html)\b/g) ?? []).length;
  const density = uniqueTerms.size / Math.max(1, approxTokens);

  return density + codeLikeTerms * 0.05 + roleMarkers * 0.1 + filePaths * 0.2;
}
