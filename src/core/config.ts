import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { getEnv, getEnvBoolean } from './env.js';
import { defaultConfigDir, defaultDataDir, ensureDir, expandHome, resolvePaths } from './paths.js';

const providerSchema = z.object({
  enabled: z.boolean().default(true),
  roots: z.array(z.string()).default([]),
});

const configSchema = z.object({
  paths: z.object({
    dataDir: z.string().default(defaultDataDir()),
    configDir: z.string().default(defaultConfigDir()),
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
  embeddings: z.object({
    provider: z.literal('voyage').default('voyage'),
    model: z.string().default('voyage-code-3'),
    dimensions: z.number().int().positive().default(1024),
    batchSize: z.number().int().positive().default(32),
    redactBeforeSend: z.boolean().default(true),
    enabled: z.boolean().default(true),
    apiKey: z.string().optional(),
  }).default({}),
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

function normalizeConfig(config: RecallConfig): RecallConfig {
  return {
    ...config,
    paths: {
      dataDir: expandHome(config.paths.dataDir),
      configDir: expandHome(config.paths.configDir),
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

  const filePaths = (fileValue.paths ?? {}) as { dataDir?: string; configDir?: string };
  const fileEmbeddings = (fileValue.embeddings ?? {}) as Record<string, unknown> & {
    apiKey?: string;
    enabled?: boolean;
  };

  const merged = {
    ...fileValue,
    paths: {
      dataDir: dataDirOverride ?? filePaths.dataDir,
      configDir: configDirOverride ?? filePaths.configDir,
    },
    embeddings: {
      ...fileEmbeddings,
      apiKey: getEnv('VOYAGE_API_KEY') ?? fileEmbeddings.apiKey,
      enabled: getEnvBoolean('RECALL_EMBEDDINGS_ENABLED') ?? fileEmbeddings.enabled,
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
