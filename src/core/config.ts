import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { getEnv, getEnvBoolean, getEnvInteger } from './env.js';
import { defaultConfigDir, defaultDataDir, defaultModelCacheDir, ensureDir, expandHome, resolvePaths } from './paths.js';

const providerSchema = z.object({
  enabled: z.boolean().default(true),
  roots: z.array(z.string()).default([]),
});

// Preprocess maps legacy 'local' -> 'ollama' and legacy 'ollama' (already canonical) stays 'ollama'.
// Fresh users (no provider key) get the default 'llama'.
const embeddingProviderSchema = z.preprocess(
  (value) => value === 'local' ? 'ollama' : value,
  z.enum(['llama', 'ollama', 'voyage']).default('llama'),
);

const LOCAL_EMBEDDING_DEFAULTS = {
  model: 'embeddinggemma',
  dimensions: 768,
  endpoint: 'http://127.0.0.1:11434',
} as const;

const LLAMA_EMBEDDING_DEFAULTS = {
  model: 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf',
  dimensions: 768,
  endpoint: undefined,
} as const;

const VOYAGE_EMBEDDING_DEFAULTS = {
  model: 'voyage-code-3',
  dimensions: 1024,
  endpoint: 'https://api.voyageai.com/v1/embeddings',
} as const;

const embeddingsSchema = z.object({
  provider: embeddingProviderSchema,
  model: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().default(32),
  redactBeforeSend: z.boolean().default(true),
  enabled: z.boolean().default(true),
  apiKey: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional(),
}).default({}).transform((value) => {
  let defaults: { model: string; dimensions: number; endpoint: string | undefined };
  if (value.provider === 'voyage') {
    defaults = VOYAGE_EMBEDDING_DEFAULTS;
  } else if (value.provider === 'llama') {
    defaults = LLAMA_EMBEDDING_DEFAULTS;
  } else {
    defaults = LOCAL_EMBEDDING_DEFAULTS;
  }
  return {
    provider: value.provider,
    model: value.model ?? defaults.model,
    dimensions: value.dimensions ?? defaults.dimensions,
    batchSize: value.batchSize,
    redactBeforeSend: value.redactBeforeSend,
    enabled: value.enabled,
    // For 'llama', keep endpoint undefined even if defaults.endpoint is undefined
    endpoint: value.provider === 'llama' ? undefined : (value.endpoint ?? defaults.endpoint),
    ...(value.apiKey !== undefined ? { apiKey: value.apiKey } : {}),
  };
});

const configSchema = z.object({
  paths: z.object({
    dataDir: z.string().default(defaultDataDir()),
    configDir: z.string().default(defaultConfigDir()),
    modelCacheDir: z.string().default(defaultModelCacheDir()),
  }),
  providers: z.object({
    claude: providerSchema.default({ enabled: true, roots: ['~/.claude/projects'] }),
    codex: providerSchema.default({ enabled: true, roots: ['~/.codex/sessions'] }),
    pi: providerSchema.default({ enabled: true, roots: ['~/.pi/agent/sessions'] }),
  }).default({}),
  indexing: z.object({
    chunkTokens: z.number().int().positive().default(512),
    chunkOverlapTokens: z.number().int().nonnegative().default(96),
    maxChunksPerSession: z.number().int().positive().default(40),
    backgroundSyncOnLaunch: z.boolean().default(true),
  }).default({}),
  embeddings: embeddingsSchema,
  search: z.object({
    defaultLimit: z.number().int().positive().default(20),
    includeSubagents: z.boolean().default(false),
    recencyHalfLifeDays: z.number().positive().default(30),
  }).default({}),
  launch: z.object({
    preferPiSessionIdFallback: z.boolean().default(false),
  }).default({}),
});

export type RecallConfig = z.infer<typeof configSchema>;

export const defaultConfig: RecallConfig = configSchema.parse({
  paths: {},
  providers: {},
  indexing: {},
  embeddings: {},
  search: {},
  launch: {},
});

function normalizeEmbeddingProvider(value: unknown): 'llama' | 'ollama' | 'voyage' | undefined {
  // Legacy 'local' maps to 'ollama'
  if (value === 'local' || value === 'ollama') {
    return 'ollama';
  }

  if (value === 'llama' || value === 'voyage') {
    return value;
  }

  return undefined;
}

function normalizeConfig(config: RecallConfig): RecallConfig {
  return {
    ...config,
    paths: {
      dataDir: expandHome(config.paths.dataDir),
      configDir: expandHome(config.paths.configDir),
      modelCacheDir: expandHome(config.paths.modelCacheDir),
    },
    providers: {
      claude: {
        ...config.providers.claude,
        roots: config.providers.claude.roots.map(expandHome),
      },
      codex: {
        ...config.providers.codex,
        roots: config.providers.codex.roots.map(expandHome),
      },
      pi: {
        ...config.providers.pi,
        roots: config.providers.pi.roots.map(expandHome),
      },
    },
  };
}

export async function loadConfig(): Promise<RecallConfig> {
  const dataDirOverride = getEnv('RECALL_DATA_DIR');
  const configDirOverride = getEnv('RECALL_CONFIG_DIR');
  const pathOverrides: { dataDir?: string; configDir?: string } = {};

  if (dataDirOverride !== undefined) {
    pathOverrides.dataDir = dataDirOverride;
  }

  if (configDirOverride !== undefined) {
    pathOverrides.configDir = configDirOverride;
  }

  const paths = resolvePaths(pathOverrides);
  const configFile = paths.configPath;

  let fileValue: Record<string, unknown> = {};

  try {
    const raw = await readFile(configFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fileValue = parsed as Record<string, unknown>;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new ConfigError(`Failed to read config at ${configFile}`, { cause: error as Error });
    }
  }

  const filePaths = (fileValue.paths ?? {}) as { dataDir?: string; configDir?: string; modelCacheDir?: string };
  const fileEmbeddings = (fileValue.embeddings ?? {}) as Record<string, unknown> & {
    apiKey?: string;
    enabled?: boolean;
    provider?: string;
  };
  const providerOverride = getEnv('RECALL_EMBEDDINGS_PROVIDER');
  const voyageApiKeyOverride = getEnv('VOYAGE_API_KEY');
  const genericApiKeyOverride = getEnv('RECALL_EMBEDDINGS_API_KEY');
  const modelCacheDirOverride = getEnv('RECALL_MODEL_CACHE_DIR');
  const fileEmbeddingProvider = normalizeEmbeddingProvider(fileEmbeddings.provider);
  // normalizeEmbeddingProvider maps 'local' -> 'ollama'; pass through 'llama'/'ollama'/'voyage'
  const normalizedProviderOverride = providerOverride ? normalizeEmbeddingProvider(providerOverride) : undefined;
  const rawEmbeddingProvider = normalizedProviderOverride
    ?? (voyageApiKeyOverride || genericApiKeyOverride ? 'voyage' : fileEmbeddingProvider ?? 'llama');
  const useFileEmbeddingOptions = fileEmbeddingProvider === undefined || fileEmbeddingProvider === normalizeEmbeddingProvider(rawEmbeddingProvider);
  // OLLAMA_HOST only applies when using Ollama backend (not llama/voyage)
  const embeddingEndpointOverride = getEnv('RECALL_EMBEDDINGS_ENDPOINT')
    ?? (rawEmbeddingProvider === 'ollama' ? getEnv('OLLAMA_HOST') : undefined);
  const embeddingApiKeyOverride = genericApiKeyOverride
    ?? (rawEmbeddingProvider === 'voyage' ? voyageApiKeyOverride : undefined);

  const merged = {
    ...fileValue,
    paths: {
      dataDir: dataDirOverride ?? filePaths.dataDir,
      configDir: configDirOverride ?? filePaths.configDir,
      modelCacheDir: modelCacheDirOverride ?? filePaths.modelCacheDir,
    },
    embeddings: {
      ...fileEmbeddings,
      provider: rawEmbeddingProvider,
      apiKey: embeddingApiKeyOverride ?? (rawEmbeddingProvider === 'voyage' ? fileEmbeddings.apiKey : undefined),
      enabled: getEnvBoolean('RECALL_EMBEDDINGS_ENABLED') ?? fileEmbeddings.enabled,
      model: getEnv('RECALL_EMBEDDINGS_MODEL') ?? (useFileEmbeddingOptions ? fileEmbeddings.model : undefined),
      dimensions: getEnvInteger('RECALL_EMBEDDINGS_DIMENSIONS') ?? (useFileEmbeddingOptions ? fileEmbeddings.dimensions : undefined),
      batchSize: getEnvInteger('RECALL_EMBEDDINGS_BATCH_SIZE') ?? fileEmbeddings.batchSize,
      endpoint: embeddingEndpointOverride ?? (useFileEmbeddingOptions ? fileEmbeddings.endpoint : undefined),
    },
  };

  return normalizeConfig(configSchema.parse(merged));
}

export async function ensureConfigFile(): Promise<{ config: RecallConfig; path: string }> {
  const config = await loadConfig();
  const paths = resolvePaths(config.paths);

  await ensureDir(paths.configDir);
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await chmod(paths.configPath, 0o600);

  return { config, path: paths.configPath };
}

export async function ensureConfigScaffoldFile(): Promise<{ config: RecallConfig; path: string }> {
  const config = await loadConfig();
  const paths = resolvePaths(config.paths);

  await ensureDir(paths.configDir);

  try {
    await access(paths.configPath);
    return { config, path: paths.configPath };
  } catch {
    const scaffold: RecallConfig = {
      ...config,
      embeddings: {
        ...config.embeddings,
      },
    };

    delete scaffold.embeddings.apiKey;

    await writeFile(paths.configPath, `${JSON.stringify(scaffold, null, 2)}\n`, 'utf8');
    await chmod(paths.configPath, 0o600);

    return { config, path: paths.configPath };
  }
}
