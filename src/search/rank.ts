import type { SearchResult } from '../domain/result.js';
import type { QueryFilters } from '../domain/query.js';
import { buildFtsQueryPlan } from './fts.js';
import type { FusedSearchCandidate, SearchResultSeed } from './models.js';
import { chooseSnippet } from './snippets.js';

export interface RankingWeights {
  rrfK: number;
  recencyWeight: number;
  recencyHalfLifeDays: number;
  repoBoost: number;
  cwdBoost: number;
  titleSubstringBoost: number;
  titleTokenBoost: number;
  firstPromptExactishBoost: number;
  bodyExactishBoost: number;
  shortPenalty: number;
  subagentPenalty: number;
  missingCwdPenalty: number;
}

export interface RankingContext {
  freeText: string;
  currentCwd?: string;
  currentRepo?: string | null;
  now?: Date;
  filters?: QueryFilters;
  weights?: Partial<RankingWeights>;
}

export interface ScoreBreakdown {
  baseScore: number;
  recencyBoost: number;
  repoBoost: number;
  cwdBoost: number;
  titleBoost: number;
  exactishBoost: number;
  shortPenalty: number;
  subagentPenalty: number;
  missingCwdPenalty: number;
  total: number;
}

export const defaultRankingWeights: RankingWeights = {
  rrfK: 60,
  recencyWeight: 0.08,
  recencyHalfLifeDays: 30,
  repoBoost: 0.1,
  cwdBoost: 0.05,
  titleSubstringBoost: 0.12,
  titleTokenBoost: 0.08,
  firstPromptExactishBoost: 0.1,
  bodyExactishBoost: 0.08,
  shortPenalty: 0.06,
  subagentPenalty: 0.2,
  missingCwdPenalty: 0.03,
};

export function rankSearchCandidates(
  candidates: readonly SearchResultSeed[],
  context: RankingContext,
): SearchResult[] {
  return candidates
    .map((candidate) => ({
      candidate,
      breakdown: scoreSearchCandidate(candidate, context),
    }))
    .sort((left, right) => compareScoredCandidates(left.candidate, right.candidate, left.breakdown.total, right.breakdown.total, context.freeText))
    .map(({ candidate, breakdown }) => toSearchResult(candidate, breakdown.total, context.freeText));
}

export function rankBrowseCandidates(
  candidates: readonly SearchResultSeed[],
  context: Omit<RankingContext, 'freeText'>,
): SearchResult[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: calculateBrowseScore(candidate, context),
    }))
    .sort((left, right) => compareBrowseCandidates(left.candidate, right.candidate, left.score, right.score))
    .map(({ candidate, score }) => toSearchResult(candidate, score, ''));
}

export function scoreSearchCandidate(candidate: SearchResultSeed, context: RankingContext): ScoreBreakdown {
  const weights = { ...defaultRankingWeights, ...context.weights };
  const now = context.now ?? new Date();
  const queryPlan = buildFtsQueryPlan(context.freeText);

  const baseScore = resolveBaseScore(candidate, weights.rrfK);
  const recencyBoost = calculateRecencyBoost(candidate.updatedAt, now, weights);
  const repoBoost = shouldApplyRepoBoost(candidate, context.filters, context.currentRepo) ? weights.repoBoost : 0;
  const cwdBoost = matchesCurrentCwd(candidate.cwd, context.currentCwd) ? weights.cwdBoost : 0;
  const titleBoost = calculateTitleBoost(candidate, queryPlan.normalizedText, queryPlan.tokens, weights);
  const exactishBoost = calculateExactishBoost(candidate, queryPlan.exactishTerms, weights);
  const shortPenalty = isShortSession(candidate) ? weights.shortPenalty : 0;
  const subagentPenalty = candidate.isSubagent ? weights.subagentPenalty : 0;
  const missingCwdPenalty = candidate.cwd.trim().length === 0 ? weights.missingCwdPenalty : 0;
  const total = baseScore
    + recencyBoost
    + repoBoost
    + cwdBoost
    + titleBoost
    + exactishBoost
    - shortPenalty
    - subagentPenalty
    - missingCwdPenalty;

  return {
    baseScore,
    recencyBoost,
    repoBoost,
    cwdBoost,
    titleBoost,
    exactishBoost,
    shortPenalty,
    subagentPenalty,
    missingCwdPenalty,
    total,
  };
}

function calculateBrowseScore(
  candidate: SearchResultSeed,
  context: Omit<RankingContext, 'freeText'>,
): number {
  const weights = { ...defaultRankingWeights, ...context.weights };
  const now = context.now ?? new Date();

  return calculateRecencyBoost(candidate.updatedAt, now, weights)
    + (shouldApplyRepoBoost(candidate, context.filters, context.currentRepo) ? weights.repoBoost : 0)
    + (matchesCurrentCwd(candidate.cwd, context.currentCwd) ? weights.cwdBoost : 0)
    - (candidate.isSubagent ? weights.subagentPenalty : 0)
    - (isShortSession(candidate) ? weights.shortPenalty : 0)
    - (candidate.cwd.trim().length === 0 ? weights.missingCwdPenalty : 0);
}

function resolveBaseScore(candidate: SearchResultSeed, rrfK: number): number {
  if ('fusionScore' in candidate) {
    return (candidate as FusedSearchCandidate).fusionScore;
  }

  let score = 0;

  if (candidate.keywordRank !== undefined) {
    score += 1 / (rrfK + candidate.keywordRank);
  } else if (candidate.keywordScore !== undefined) {
    score += candidate.keywordScore;
  }

  if (candidate.vectorRank !== undefined) {
    score += 1 / (rrfK + candidate.vectorRank);
  } else if (candidate.vectorScore !== undefined) {
    score += candidate.vectorScore;
  }

  return score;
}

function calculateRecencyBoost(updatedAt: string, now: Date, weights: RankingWeights): number {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return 0;
  }

  const ageMs = Math.max(0, now.getTime() - updated.getTime());
  const ageDays = ageMs / 86_400_000;
  const decay = Math.pow(0.5, ageDays / weights.recencyHalfLifeDays);

  return weights.recencyWeight * decay;
}

function shouldApplyRepoBoost(
  candidate: SearchResultSeed,
  filters: QueryFilters | undefined,
  currentRepo: string | null | undefined,
): boolean {
  if (!currentRepo || filters?.repo) {
    return false;
  }

  return candidate.repo === currentRepo;
}

function matchesCurrentCwd(candidateCwd: string, currentCwd: string | undefined): boolean {
  if (!candidateCwd || !currentCwd) {
    return false;
  }

  const normalizedCandidate = normalizePath(candidateCwd);
  const normalizedCurrent = normalizePath(currentCwd);

  return normalizedCandidate.startsWith(normalizedCurrent) || normalizedCurrent.startsWith(normalizedCandidate);
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function calculateTitleBoost(
  candidate: SearchResultSeed,
  normalizedQuery: string,
  tokens: readonly string[],
  weights: RankingWeights,
): number {
  const normalizedTitle = candidate.title.toLowerCase();
  let boost = 0;

  if (normalizedQuery && normalizedTitle.includes(normalizedQuery.toLowerCase())) {
    boost += weights.titleSubstringBoost;
  }

  if (tokens.length > 0 && tokens.every((token) => normalizedTitle.includes(token.toLowerCase()))) {
    boost += weights.titleTokenBoost;
  }

  return boost;
}

function calculateExactishBoost(
  candidate: SearchResultSeed,
  exactishTerms: readonly string[],
  weights: RankingWeights,
): number {
  if (exactishTerms.length === 0) {
    return 0;
  }

  const firstPrompt = candidate.firstPrompt?.toLowerCase() ?? '';
  const body = candidate.body?.toLowerCase() ?? '';
  let boost = 0;

  for (const term of exactishTerms) {
    const normalizedTerm = term.toLowerCase();

    if (firstPrompt.includes(normalizedTerm)) {
      boost += weights.firstPromptExactishBoost;
      continue;
    }

    if (body.includes(normalizedTerm)) {
      boost += weights.bodyExactishBoost;
    }
  }

  return boost;
}

function isShortSession(candidate: SearchResultSeed): boolean {
  const bodyLength = candidate.body?.trim().length ?? 0;
  return candidate.messageCount < 4 || bodyLength < 240;
}

function compareScoredCandidates(
  leftCandidate: SearchResultSeed,
  rightCandidate: SearchResultSeed,
  leftScore: number,
  rightScore: number,
  freeText: string,
): number {
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  const leftExactTitle = hasExactTitleHit(leftCandidate, freeText);
  const rightExactTitle = hasExactTitleHit(rightCandidate, freeText);
  if (leftExactTitle !== rightExactTitle) {
    return Number(rightExactTitle) - Number(leftExactTitle);
  }

  const updatedCompare = compareUpdatedAt(rightCandidate.updatedAt, leftCandidate.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  return (leftCandidate.keywordRank ?? Number.MAX_SAFE_INTEGER) - (rightCandidate.keywordRank ?? Number.MAX_SAFE_INTEGER);
}

function compareBrowseCandidates(
  leftCandidate: SearchResultSeed,
  rightCandidate: SearchResultSeed,
  leftScore: number,
  rightScore: number,
): number {
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  return compareUpdatedAt(rightCandidate.updatedAt, leftCandidate.updatedAt);
}

function compareUpdatedAt(left: string, right: string): number {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return 0;
  }

  return leftTime - rightTime;
}

function hasExactTitleHit(candidate: SearchResultSeed, freeText: string): boolean {
  const normalizedQuery = freeText.trim().toLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  return candidate.title.toLowerCase().includes(normalizedQuery);
}

function toSearchResult(candidate: SearchResultSeed, score: number, freeText: string): SearchResult {
  const snippet = chooseSnippet({
    freeText,
    ...(candidate.previewSnippet ? { previewSnippet: candidate.previewSnippet } : {}),
    ...(candidate.previewSnippetSource ? { previewSnippetSource: candidate.previewSnippetSource } : {}),
    ...(candidate.ftsSnippet !== undefined ? { ftsSnippet: candidate.ftsSnippet } : {}),
    ...(candidate.semanticSnippet !== undefined ? { semanticSnippet: candidate.semanticSnippet } : {}),
    ...(candidate.body ? { body: candidate.body } : {}),
    ...(candidate.keywordRank !== undefined ? { keywordRank: candidate.keywordRank } : {}),
    ...(candidate.vectorRank !== undefined ? { vectorRank: candidate.vectorRank } : {}),
  });

  const result: SearchResult = {
    uid: candidate.uid,
    provider: candidate.provider,
    nativeId: candidate.nativeId,
    title: candidate.title,
    repo: candidate.repo,
    branch: candidate.branch,
    surface: candidate.surface,
    cwd: candidate.cwd,
    updatedAt: candidate.updatedAt,
    createdAt: candidate.createdAt,
    isSubagent: candidate.isSubagent,
    messageCount: candidate.messageCount,
    models: candidate.models,
    resumeCmd: candidate.resumeCmd,
    forkCmd: candidate.forkCmd,
    snippet: snippet.snippet,
    snippetSource: snippet.snippetSource,
    score,
  };

  if (candidate.keywordScore !== undefined) {
    result.keywordScore = candidate.keywordScore;
  }

  if (candidate.vectorScore !== undefined) {
    result.vectorScore = candidate.vectorScore;
  }

  return result;
}
