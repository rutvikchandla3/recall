import { defaultAdapters } from '../adapters/index.js';
import type { SessionAdapter } from '../adapters/types.js';
import type { ParsedSession, SessionDocument, ProviderId } from '../domain/session.js';
import { discoverSessions, type DiscoverSessionsOptions, type DiscoveryCandidate } from './discover.js';
import { mergeParsedSessions, normalizeParsedSessions, type NormalizeSessionOptions } from './normalize.js';

export interface ParseFailure {
  provider: ProviderId;
  path: string;
  error: string;
}

export interface ParsedCandidate {
  candidate: DiscoveryCandidate;
  session: ParsedSession;
}

export interface IngestSessionsOptions extends DiscoverSessionsOptions, NormalizeSessionOptions {
  adapters?: SessionAdapter[];
}

export interface IngestSessionsResult {
  discovered: DiscoveryCandidate[];
  parsed: ParsedSession[];
  documents: SessionDocument[];
  failures: ParseFailure[];
}

function adapterByProvider(adapters: SessionAdapter[]): Map<ProviderId, SessionAdapter> {
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}

export async function parseDiscoveredSessions(
  candidates: DiscoveryCandidate[],
  adapters: SessionAdapter[] = defaultAdapters,
): Promise<{ parsed: ParsedSession[]; failures: ParseFailure[] }> {
  const adapterMap = adapterByProvider(adapters);
  const parsed: ParsedSession[] = [];
  const failures: ParseFailure[] = [];

  for (const candidate of candidates) {
    const adapter = adapterMap.get(candidate.provider);
    if (!adapter) {
      failures.push({
        provider: candidate.provider,
        path: candidate.path,
        error: `No adapter registered for provider ${candidate.provider}`,
      });
      continue;
    }

    try {
      const result = await adapter.parse(candidate.path);
      if (!result) {
        continue;
      }

      if (Array.isArray(result)) {
        parsed.push(...result);
      } else {
        parsed.push(result);
      }
    } catch (error) {
      failures.push({
        provider: candidate.provider,
        path: candidate.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { parsed, failures };
}

export async function ingestSessions(options: IngestSessionsOptions = {}): Promise<IngestSessionsResult> {
  const adapters = options.adapters ?? defaultAdapters;
  const discovered = await discoverSessions({
    ...options,
    adapters,
  });

  const { parsed, failures } = await parseDiscoveredSessions(discovered, adapters);
  const merged = mergeParsedSessions(parsed);
  const documents = await normalizeParsedSessions(merged, options);

  return {
    discovered,
    parsed: merged,
    documents,
    failures,
  };
}
