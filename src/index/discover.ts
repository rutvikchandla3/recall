import type { RecallConfig } from '../core/config.js';
import { loadConfig } from '../core/config.js';
import type { ProviderId } from '../domain/session.js';
import { defaultAdapters } from '../adapters/index.js';
import { isLikelySubagentPath } from '../adapters/shared.js';
import type { SessionAdapter } from '../adapters/types.js';
import { statSafe } from './fs.js';

export interface DiscoveryCandidate {
  provider: ProviderId;
  path: string;
  size: number;
  mtimeMs: number;
  likelySubagent: boolean;
}

export interface DiscoverSessionsOptions {
  adapters?: SessionAdapter[];
  roots?: Partial<Record<ProviderId, string[]>>;
  config?: RecallConfig;
}

function rootsFromConfig(config: RecallConfig, provider: ProviderId): string[] {
  const providerConfig = config.providers[provider];
  if (!providerConfig.enabled) {
    return [];
  }

  return providerConfig.roots;
}

async function resolveRoots(
  options: DiscoverSessionsOptions,
  provider: ProviderId,
  config: RecallConfig | null,
): Promise<string[]> {
  if (options.roots?.[provider]?.length) {
    return options.roots[provider] ?? [];
  }

  if (!config) {
    return [];
  }

  return rootsFromConfig(config, provider);
}

export async function* iterateDiscoveredSessions(
  options: DiscoverSessionsOptions = {},
): AsyncGenerator<DiscoveryCandidate> {
  const adapters = options.adapters ?? defaultAdapters;
  let config = options.config ?? null;

  for (const adapter of adapters) {
    if (!options.roots?.[adapter.id]?.length && !config) {
      config = await loadConfig();
    }

    const roots = await resolveRoots(options, adapter.id, config);
    if (roots.length === 0) {
      continue;
    }

    for await (const filePath of adapter.discover({ roots })) {
      const details = await statSafe(filePath);
      if (!details) {
        continue;
      }

      yield {
        provider: adapter.id,
        path: filePath,
        size: details.size,
        mtimeMs: details.mtimeMs,
        likelySubagent: isLikelySubagentPath(adapter.id, filePath),
      };
    }
  }
}

export async function discoverSessions(options: DiscoverSessionsOptions = {}): Promise<DiscoveryCandidate[]> {
  const discovered: DiscoveryCandidate[] = [];

  for await (const candidate of iterateDiscoveredSessions(options)) {
    discovered.push(candidate);
  }

  discovered.sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider.localeCompare(right.provider);
    }

    return left.path.localeCompare(right.path);
  });

  return discovered;
}
