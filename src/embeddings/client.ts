import type { RecallConfig } from '../core/config.js';
import { OllamaEmbeddingClient, ollamaSetupCommands, type OllamaReadiness } from './ollama.js';
import { VoyageEmbeddingClient } from './voyage.js';
import { LlamaCppEmbeddingClient } from './llamacpp.js';
import { inspectLlamaModel, ftsFallbackReadiness } from './llamacpp-setup.js';

export type EmbeddingInputType = 'document' | 'query';

export interface EmbedBatchOptions {
  inputType: EmbeddingInputType;
}

export interface EmbeddingClient {
  embed(inputs: readonly string[], options: EmbedBatchOptions): Promise<number[][]>;
}

export interface EmbeddingReadiness {
  ok: boolean;
  message?: string;
  setup?: string[];
}

export function createEmbeddingClient(config: RecallConfig): EmbeddingClient {
  if (config.embeddings.provider === 'voyage') {
    if (!config.embeddings.apiKey) {
      throw new Error('VOYAGE_API_KEY is required when embeddings.provider is "voyage".');
    }

    return new VoyageEmbeddingClient({
      apiKey: config.embeddings.apiKey,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
      ...(config.embeddings.endpoint !== undefined ? { endpoint: config.embeddings.endpoint } : {}),
    });
  }

  if (config.embeddings.provider === 'llama') {
    return new LlamaCppEmbeddingClient({
      model: config.embeddings.model,
      modelUri: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
      gpu: 'auto',
    });
  }

  // 'ollama' provider
  return new OllamaEmbeddingClient({
    model: config.embeddings.model,
    dimensions: config.embeddings.dimensions,
    ...(config.embeddings.endpoint !== undefined ? { endpoint: config.embeddings.endpoint } : {}),
  });
}

export async function checkEmbeddingReadiness(config: RecallConfig): Promise<EmbeddingReadiness> {
  if (!config.embeddings.enabled) {
    return { ok: false, message: 'Embeddings are disabled in config.' };
  }

  if (config.embeddings.provider === 'voyage') {
    if (!config.embeddings.apiKey) {
      return {
        ok: false,
        message: 'Voyage embeddings are selected, but VOYAGE_API_KEY is not set.',
        setup: [
          'Set VOYAGE_API_KEY in your environment, or set embeddings.apiKey in ~/.config/recall/config.json.',
          'Alternatively switch back to local embeddings with embeddings.provider = "ollama".',
        ],
      };
    }

    return { ok: true };
  }

  if (config.embeddings.provider === 'llama') {
    // Strictly non-interactive: stat the cache dir only, never download or prompt
    const { cached } = await inspectLlamaModel({
      modelUri: config.embeddings.model,
      cacheDir: config.paths.modelCacheDir,
    });

    if (cached) {
      return { ok: true };
    }

    return ftsFallbackReadiness(config.embeddings.model, config.paths.modelCacheDir);
  }

  // 'ollama' provider
  const client = new OllamaEmbeddingClient({
    model: config.embeddings.model,
    dimensions: config.embeddings.dimensions,
    ...(config.embeddings.endpoint !== undefined ? { endpoint: config.embeddings.endpoint } : {}),
  });
  return normalizeReadiness(await client.checkReady());
}

export function isEmbeddingConfigured(config: RecallConfig): boolean {
  if (!config.embeddings.enabled) {
    return false;
  }

  if (config.embeddings.provider === 'voyage') {
    return Boolean(config.embeddings.apiKey);
  }

  // 'llama' and 'ollama' are always "configured" (model presence handled by readiness)
  return true;
}

export function embeddingProviderLabel(config: RecallConfig): string {
  if (config.embeddings.provider === 'llama') {
    return 'local (llama.cpp)';
  }

  if (config.embeddings.provider === 'voyage') {
    return 'Voyage';
  }

  return 'local Ollama';
}

export function embeddingModelCacheKey(config: RecallConfig): string {
  return config.embeddings.provider === 'voyage'
    ? config.embeddings.model
    : `${config.embeddings.provider}:${config.embeddings.model}`;
}

export function formatEmbeddingSetupHelp(config: RecallConfig): string[] {
  if (config.embeddings.provider === 'voyage') {
    return [
      'Set embeddings.provider to "voyage" in ~/.config/recall/config.json.',
      'Set VOYAGE_API_KEY in your environment (or embeddings.apiKey in config).',
      'Use model "voyage-code-3" with dimensions 1024 unless you know you need a different Voyage model.',
    ];
  }

  if (config.embeddings.provider === 'llama') {
    return ftsFallbackReadiness(config.embeddings.model, config.paths.modelCacheDir).setup ?? [];
  }

  return ollamaSetupCommands(config.embeddings.model);
}

function normalizeReadiness(readiness: OllamaReadiness): EmbeddingReadiness {
  return {
    ok: readiness.ok,
    ...(readiness.message !== undefined ? { message: readiness.message } : {}),
    ...(readiness.setup !== undefined ? { setup: readiness.setup } : {}),
  };
}
