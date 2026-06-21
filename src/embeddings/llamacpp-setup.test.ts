import { describe, expect, it } from 'vitest';
import {
  decideDownloadAction,
  parseConfirmAnswer,
  ftsFallbackReadiness,
  resolveLlamaCacheFilename,
  ensureLlamaModel,
} from './llamacpp-setup.js';

describe('decideDownloadAction', () => {
  it('returns use-cache when cached and refresh is false', () => {
    expect(decideDownloadAction({ cached: true, refresh: false, isTTY: false, autoDownloadEnv: false, forceYes: false })).toBe('use-cache');
  });

  it('returns prompt when cached but refresh is true and TTY is available', () => {
    // refresh=true ignores the cache
    expect(decideDownloadAction({ cached: true, refresh: true, isTTY: true, autoDownloadEnv: false, forceYes: false })).toBe('prompt');
  });

  it('returns auto-download when forceYes is true (regardless of cache)', () => {
    expect(decideDownloadAction({ cached: false, refresh: false, isTTY: false, autoDownloadEnv: false, forceYes: true })).toBe('auto-download');
  });

  it('returns auto-download when autoDownloadEnv is true', () => {
    expect(decideDownloadAction({ cached: false, refresh: false, isTTY: false, autoDownloadEnv: true, forceYes: false })).toBe('auto-download');
  });

  it('returns prompt when not cached and TTY is available', () => {
    expect(decideDownloadAction({ cached: false, refresh: false, isTTY: true, autoDownloadEnv: false, forceYes: false })).toBe('prompt');
  });

  it('returns fallback-fts when not cached and no TTY and no override (the critical non-interactive case)', () => {
    expect(decideDownloadAction({ cached: false, refresh: false, isTTY: false, autoDownloadEnv: false, forceYes: false })).toBe('fallback-fts');
  });

  it('forceYes overrides even when autoDownloadEnv is false', () => {
    expect(decideDownloadAction({ cached: true, refresh: true, isTTY: false, autoDownloadEnv: false, forceYes: true })).toBe('auto-download');
  });

  it('autoDownloadEnv overrides TTY=false to auto-download', () => {
    expect(decideDownloadAction({ cached: false, refresh: false, isTTY: false, autoDownloadEnv: true, forceYes: false })).toBe('auto-download');
  });
});

describe('parseConfirmAnswer', () => {
  it('empty string (bare Enter) returns true — default YES for [Y/n]', () => {
    expect(parseConfirmAnswer('')).toBe(true);
  });

  it('y returns true', () => {
    expect(parseConfirmAnswer('y')).toBe(true);
  });

  it('Y returns true (case-insensitive)', () => {
    expect(parseConfirmAnswer('Y')).toBe(true);
  });

  it('yes returns true', () => {
    expect(parseConfirmAnswer('yes')).toBe(true);
  });

  it('YES with trailing space returns true (trimmed)', () => {
    expect(parseConfirmAnswer('YES ')).toBe(true);
  });

  it('n returns false', () => {
    expect(parseConfirmAnswer('n')).toBe(false);
  });

  it('no returns false', () => {
    expect(parseConfirmAnswer('no')).toBe(false);
  });

  it('maybe returns false', () => {
    expect(parseConfirmAnswer('maybe')).toBe(false);
  });

  it('x returns false', () => {
    expect(parseConfirmAnswer('x')).toBe(false);
  });
});

describe('ftsFallbackReadiness', () => {
  const MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
  const CACHE_DIR = '/home/user/.cache/recall/models';

  it('returns ok: false', () => {
    const result = ftsFallbackReadiness(MODEL_URI, CACHE_DIR);
    expect(result.ok).toBe(false);
  });

  it('setup[] contains a line mentioning recall setup and ~300MB', () => {
    const result = ftsFallbackReadiness(MODEL_URI, CACHE_DIR);
    const hasSetupLine = result.setup?.some(
      (line) => line.includes('recall setup') && line.includes('~300MB'),
    );
    expect(hasSetupLine).toBe(true);
  });

  it('setup[] contains a line mentioning RECALL_AUTO_DOWNLOAD', () => {
    const result = ftsFallbackReadiness(MODEL_URI, CACHE_DIR);
    const hasEnvLine = result.setup?.some((line) => line.includes('RECALL_AUTO_DOWNLOAD'));
    expect(hasEnvLine).toBe(true);
  });

  it('setup[] contains a line mentioning VOYAGE_API_KEY', () => {
    const result = ftsFallbackReadiness(MODEL_URI, CACHE_DIR);
    const hasVoyageLine = result.setup?.some((line) => line.includes('VOYAGE_API_KEY'));
    expect(hasVoyageLine).toBe(true);
  });

  it('setup[] contains a line mentioning keyword/FTS search', () => {
    const result = ftsFallbackReadiness(MODEL_URI, CACHE_DIR);
    const hasFtsLine = result.setup?.some(
      (line) => line.toLowerCase().includes('keyword') || line.toLowerCase().includes('fts'),
    );
    expect(hasFtsLine).toBe(true);
  });
});

describe('resolveLlamaCacheFilename', () => {
  it('extracts the gguf filename from a hf: URI', () => {
    expect(
      resolveLlamaCacheFilename('hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf'),
    ).toBe('embeddinggemma-300M-Q8_0.gguf');
  });

  it('handles a simple filename with no slash', () => {
    expect(resolveLlamaCacheFilename('model.gguf')).toBe('model.gguf');
  });
});

describe('ensureLlamaModel with injected stubs', () => {
  const MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
  const CACHE_DIR = '/tmp/test-recall-models';

  // A stub downloader that succeeds without touching the network
  function makeDownloaderStub(calledWith: { count: number }) {
    return async (opts: { modelUri: string; cacheDir: string; filename: string }) => {
      calledWith.count += 1;
      return `${opts.cacheDir}/${opts.filename}`;
    };
  }

  it('returns ready without calling downloader when model is already cached', async () => {
    const downloaderCalls = { count: 0 };

    // Use a temp dir where we create the expected file to simulate a cached state
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const tempDir = await mkdtemp(join(tmpdir(), 'recall-llamacpp-test-'));
    try {
      // Create the expected file to simulate cached state
      const filename = resolveLlamaCacheFilename(MODEL_URI);
      await writeFile(join(tempDir, filename), 'stub-gguf-data');

      const result = await ensureLlamaModel({
        modelUri: MODEL_URI,
        cacheDir: tempDir,
        dimensions: 768,
        forceYes: false,
        refresh: false,
        isTTY: false,
        autoDownloadEnv: false,
        downloader: makeDownloaderStub(downloaderCalls),
      });

      expect(result.status).toBe('ready');
      expect(downloaderCalls.count).toBe(0);
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns fallback without calling downloader or promptFn when not TTY and no override', async () => {
    const downloaderCalls = { count: 0 };
    const promptCalls = { count: 0 };

    const result = await ensureLlamaModel({
      modelUri: MODEL_URI,
      cacheDir: CACHE_DIR + '-nonexistent',
      dimensions: 768,
      forceYes: false,
      refresh: false,
      isTTY: false, // non-TTY: the critical case — must never prompt
      autoDownloadEnv: false,
      downloader: makeDownloaderStub(downloaderCalls),
      promptFn: async () => {
        promptCalls.count += 1;
        return true;
      },
    });

    expect(result.status).toBe('fallback');
    expect(downloaderCalls.count).toBe(0);
    expect(promptCalls.count).toBe(0);
  });

  it('calls downloader once and returns ready when forceYes is set', async () => {
    const downloaderCalls = { count: 0 };

    const result = await ensureLlamaModel({
      modelUri: MODEL_URI,
      cacheDir: CACHE_DIR + '-forceyes',
      dimensions: 768,
      forceYes: true,
      refresh: false,
      isTTY: false,
      autoDownloadEnv: false,
      downloader: makeDownloaderStub(downloaderCalls),
    });

    expect(result.status).toBe('ready');
    expect(downloaderCalls.count).toBe(1);
  });

  it('returns fallback without calling downloader when promptFn returns false', async () => {
    const downloaderCalls = { count: 0 };

    const result = await ensureLlamaModel({
      modelUri: MODEL_URI,
      cacheDir: CACHE_DIR + '-decline',
      dimensions: 768,
      forceYes: false,
      refresh: false,
      isTTY: true,
      autoDownloadEnv: false,
      downloader: makeDownloaderStub(downloaderCalls),
      promptFn: async () => false, // user declined
    });

    expect(result.status).toBe('fallback');
    expect(downloaderCalls.count).toBe(0);
  });
});
