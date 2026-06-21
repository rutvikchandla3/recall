import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig } from './config.js';

const envKeys = [
  'RECALL_CONFIG_DIR',
  'RECALL_DATA_DIR',
  'RECALL_EMBEDDINGS_PROVIDER',
  'RECALL_EMBEDDINGS_API_KEY',
  'RECALL_EMBEDDINGS_MODEL',
  'RECALL_EMBEDDINGS_DIMENSIONS',
  'RECALL_EMBEDDINGS_ENDPOINT',
  'VOYAGE_API_KEY',
  'OLLAMA_HOST',
  'RECALL_MODEL_CACHE_DIR',
  'XDG_CACHE_HOME',
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of envKeys) {
  originalEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('defaultConfig', () => {
  it('defaults to llama in-process embeddings (fresh-user default)', () => {
    expect(defaultConfig.embeddings.provider).toBe('llama');
    expect(defaultConfig.embeddings.model).toBe('hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf');
    expect(defaultConfig.embeddings.dimensions).toBe(768);
    expect(defaultConfig.embeddings.endpoint).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('uses Voyage when VOYAGE_API_KEY is present directly in the environment', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      process.env.VOYAGE_API_KEY = 'pa-test-key';
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('voyage');
      expect(config.embeddings.model).toBe('voyage-code-3');
      expect(config.embeddings.dimensions).toBe(1024);
      expect(config.embeddings.apiKey).toBe('pa-test-key');
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('uses Voyage defaults when VOYAGE_API_KEY overrides an existing local config', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), JSON.stringify({
        paths: { configDir, dataDir },
        embeddings: {
          provider: 'local',
          model: 'embeddinggemma',
          dimensions: 768,
          endpoint: 'http://127.0.0.1:11434',
        },
      }), 'utf8');
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      process.env.VOYAGE_API_KEY = 'pa-test-key';
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('voyage');
      expect(config.embeddings.model).toBe('voyage-code-3');
      expect(config.embeddings.dimensions).toBe(1024);
      expect(config.embeddings.endpoint).toBe('https://api.voyageai.com/v1/embeddings');
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('maps RECALL_EMBEDDINGS_PROVIDER=local to ollama even when VOYAGE_API_KEY exists', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      process.env.VOYAGE_API_KEY = 'pa-test-key';
      process.env.RECALL_EMBEDDINGS_PROVIDER = 'local';

      const config = await loadConfig();

      // 'local' is legacy alias for 'ollama'
      expect(config.embeddings.provider).toBe('ollama');
      expect(config.embeddings.model).toBe('embeddinggemma');
      expect(config.embeddings.apiKey).toBeUndefined();
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });
});

describe('provider backward compatibility', () => {
  it('parse({}) => llama provider with hf: model URI, 768 dims, no endpoint', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;
      delete process.env.VOYAGE_API_KEY;
      delete process.env.RECALL_EMBEDDINGS_API_KEY;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('llama');
      expect(config.embeddings.model).toBe('hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf');
      expect(config.embeddings.dimensions).toBe(768);
      expect(config.embeddings.endpoint).toBeUndefined();
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('provider "local" in config file => resolves to "ollama" with Ollama defaults (BACKWARD COMPAT)', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      await import('node:fs/promises').then(({ mkdir, writeFile }) =>
        mkdir(configDir, { recursive: true }).then(() =>
          writeFile(
            configDir + '/config.json',
            JSON.stringify({ embeddings: { provider: 'local' } }),
          ),
        ),
      );
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;
      delete process.env.VOYAGE_API_KEY;
      delete process.env.RECALL_EMBEDDINGS_API_KEY;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('ollama');
      expect(config.embeddings.model).toBe('embeddinggemma');
      expect(config.embeddings.endpoint).toBe('http://127.0.0.1:11434');
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('provider "ollama" in config file => stays "ollama"', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      await import('node:fs/promises').then(({ mkdir, writeFile }) =>
        mkdir(configDir, { recursive: true }).then(() =>
          writeFile(
            configDir + '/config.json',
            JSON.stringify({ embeddings: { provider: 'ollama' } }),
          ),
        ),
      );
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;
      delete process.env.VOYAGE_API_KEY;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('ollama');
      expect(config.embeddings.model).toBe('embeddinggemma');
      expect(config.embeddings.endpoint).toBe('http://127.0.0.1:11434');
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('provider "voyage" in config file => stays "voyage"', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      await import('node:fs/promises').then(({ mkdir, writeFile }) =>
        mkdir(configDir, { recursive: true }).then(() =>
          writeFile(
            configDir + '/config.json',
            JSON.stringify({ embeddings: { provider: 'voyage', apiKey: 'test-key' } }),
          ),
        ),
      );
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;
      delete process.env.VOYAGE_API_KEY;

      const config = await loadConfig();

      expect(config.embeddings.provider).toBe('voyage');
      expect(config.embeddings.model).toBe('voyage-code-3');
      expect(config.embeddings.dimensions).toBe(1024);
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });

  it('embeddingModelCacheKey for llama provider begins with "llama:"', async () => {
    const { configDir, dataDir } = await makeTempConfigDirs();
    try {
      process.env.RECALL_CONFIG_DIR = configDir;
      process.env.RECALL_DATA_DIR = dataDir;
      delete process.env.RECALL_EMBEDDINGS_PROVIDER;
      delete process.env.VOYAGE_API_KEY;
      delete process.env.RECALL_EMBEDDINGS_API_KEY;

      const config = await loadConfig();
      const { embeddingModelCacheKey } = await import('../embeddings/client.js');
      const cacheKey = embeddingModelCacheKey(config);

      expect(cacheKey.startsWith('llama:')).toBe(true);
    } finally {
      await cleanupTempConfigDirs(configDir, dataDir);
    }
  });
});

describe('modelCacheDir resolution', () => {
  it('defaults to ~/.cache/recall/models when XDG_CACHE_HOME is not set', async () => {
    const { defaultModelCacheDir } = await import('./paths.js');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');

    const original = process.env['XDG_CACHE_HOME'];
    delete process.env['XDG_CACHE_HOME'];

    try {
      const dir = defaultModelCacheDir();
      expect(dir).toBe(join(homedir(), '.cache', 'recall', 'models'));
    } finally {
      if (original !== undefined) {
        process.env['XDG_CACHE_HOME'] = original;
      }
    }
  });

  it('honors XDG_CACHE_HOME when set', async () => {
    const { defaultModelCacheDir } = await import('./paths.js');
    const { join } = await import('node:path');

    const original = process.env['XDG_CACHE_HOME'];
    process.env['XDG_CACHE_HOME'] = '/custom/xdg/cache';

    try {
      const dir = defaultModelCacheDir();
      expect(dir).toBe(join('/custom/xdg/cache', 'recall', 'models'));
    } finally {
      if (original !== undefined) {
        process.env['XDG_CACHE_HOME'] = original;
      } else {
        delete process.env['XDG_CACHE_HOME'];
      }
    }
  });
});

async function makeTempConfigDirs(): Promise<{ configDir: string; dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'recall-config-test-'));
  return {
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
  };
}

async function cleanupTempConfigDirs(configDir: string, dataDir: string): Promise<void> {
  await Promise.all([
    rm(configDir, { recursive: true, force: true }),
    rm(dataDir, { recursive: true, force: true }),
  ]);
}
