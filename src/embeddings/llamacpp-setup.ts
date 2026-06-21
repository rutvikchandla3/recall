import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { EmbeddingReadiness } from './client.js';
import { createProgressReporter } from '../core/progress.js';

export type DownloadAction = 'use-cache' | 'prompt' | 'auto-download' | 'fallback-fts';

export interface DecideDownloadActionInput {
  cached: boolean;
  refresh: boolean;
  isTTY: boolean;
  autoDownloadEnv: boolean;
  forceYes: boolean;
}

/**
 * Pure decision function — no IO. Determines what to do about the model download.
 */
export function decideDownloadAction(input: DecideDownloadActionInput): DownloadAction {
  if (input.cached && !input.refresh) {
    return 'use-cache';
  }

  if (input.forceYes || input.autoDownloadEnv) {
    return 'auto-download';
  }

  if (input.isTTY) {
    return 'prompt';
  }

  return 'fallback-fts';
}

/**
 * Pure function — parses a [Y/n] answer where empty/y/yes => true (default yes).
 */
export function parseConfirmAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === '' || normalized === 'y' || normalized === 'yes';
}

/**
 * Returns a non-ok EmbeddingReadiness with FTS fallback messaging.
 */
export function ftsFallbackReadiness(modelUri: string, cacheDir: string): EmbeddingReadiness {
  return {
    ok: false,
    message: `Local embedding model (${resolveLlamaCacheFilename(modelUri)}) not downloaded (~300MB). Expected in ${cacheDir}.`,
    setup: [
      'Run `recall setup` to download the embedding model (~300MB) and enable semantic search.',
      'Or set RECALL_AUTO_DOWNLOAD=1 and re-run `recall setup`.',
      'Or switch to Voyage by setting VOYAGE_API_KEY.',
      'Keyword (FTS) search still works without the model.',
    ],
  };
}

/**
 * Derives the cache filename from the hf: URI tail (the part after the last '/').
 */
export function resolveLlamaCacheFilename(modelUri: string): string {
  return modelUri.split('/').at(-1) ?? modelUri;
}

/**
 * Prompts the user for confirmation using readline.
 */
export async function readlineConfirm(promptText: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(promptText);
    return parseConfirmAnswer(answer);
  } finally {
    rl.close();
  }
}

export interface EnsureLlamaModelOpts {
  modelUri: string;
  cacheDir: string;
  dimensions: number;
  forceYes: boolean;
  refresh: boolean;
  isTTY: boolean;
  autoDownloadEnv: boolean;
  logger?: { info(msg: string): void; warn(msg: string): void };
  downloader?: (opts: { modelUri: string; cacheDir: string; filename: string; onProgress?: (status: { totalSize: number; downloadedSize: number }) => void }) => Promise<string>;
  promptFn?: (promptText: string) => Promise<boolean>;
  progress?: { onProgress?: (status: { totalSize: number; downloadedSize: number }) => void };
}

export type EnsureLlamaModelResult =
  | { status: 'ready'; modelPath: string }
  | { status: 'fallback'; readiness: EmbeddingReadiness };

/**
 * IO shell for ensuring the llama model is available.
 * Injected downloader and promptFn allow unit tests to avoid real downloads.
 */
export async function ensureLlamaModel(opts: EnsureLlamaModelOpts): Promise<EnsureLlamaModelResult> {
  const filename = resolveLlamaCacheFilename(opts.modelUri);
  const modelPath = path.join(opts.cacheDir, filename);

  // Check cache
  let cached = false;
  if (!opts.refresh) {
    try {
      await access(modelPath);
      cached = true;
    } catch {
      cached = false;
    }
  }

  const action = decideDownloadAction({
    cached,
    refresh: opts.refresh,
    isTTY: opts.isTTY,
    autoDownloadEnv: opts.autoDownloadEnv,
    forceYes: opts.forceYes,
  });

  if (action === 'use-cache') {
    return { status: 'ready', modelPath };
  }

  if (action === 'fallback-fts') {
    return { status: 'fallback', readiness: ftsFallbackReadiness(opts.modelUri, opts.cacheDir) };
  }

  if (action === 'prompt') {
    const promptFn = opts.promptFn ?? readlineConfirm;
    const promptText = `Download local embedding model embeddinggemma-300M (~300MB) to ${opts.cacheDir}? [Y/n] `;
    const confirmed = await promptFn(promptText);

    if (!confirmed) {
      return {
        status: 'fallback',
        readiness: {
          ok: false,
          message: 'Local embedding model not downloaded (~300MB).',
          setup: [
            'Run `recall setup` to download the embedding model (~300MB) and enable semantic search.',
            'Or set RECALL_AUTO_DOWNLOAD=1 and re-run `recall setup`.',
            'Or switch to Voyage by setting VOYAGE_API_KEY.',
            'Keyword (FTS) search still works without the model.',
          ],
        },
      };
    }
  }

  // action === 'auto-download' or confirmed prompt — proceed to download
  try {
    await mkdir(opts.cacheDir, { recursive: true });

    const downloader = opts.downloader ?? defaultDownloader;
    const progress = createProgressReporter({
      label: 'Downloading embeddinggemma-300M',
      total: 100,
      stream: process.stderr,
    });

    let lastPercent = 0;
    const downloadedPath = await downloader({
      modelUri: opts.modelUri,
      cacheDir: opts.cacheDir,
      filename,
      onProgress(status) {
        if (status.totalSize > 0) {
          const percent = Math.floor((status.downloadedSize / status.totalSize) * 100);
          if (percent > lastPercent) {
            lastPercent = percent;
            progress.update(percent);
          }
        }
      },
    });

    progress.finish(`Downloaded embeddinggemma-300M to ${opts.cacheDir}.`);
    return { status: 'ready', modelPath: downloadedPath };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      status: 'fallback',
      readiness: {
        ok: false,
        message: `Model download failed: ${errorMsg}`,
        setup: [
          'Run `recall setup` to download the embedding model (~300MB) and enable semantic search.',
          'Run `recall setup --refresh` to re-download a corrupt cache.',
          'Or set RECALL_AUTO_DOWNLOAD=1 and re-run `recall setup`.',
          'Or switch to Voyage by setting VOYAGE_API_KEY.',
          'Keyword (FTS) search still works without the model.',
        ],
      },
    };
  }
}

/**
 * Inspects whether the model is cached without downloading or loading it.
 * Safe to call from doctor/readiness checks.
 */
export async function inspectLlamaModel(opts: { modelUri: string; cacheDir: string }): Promise<{ cached: boolean; cacheDir: string; filename: string }> {
  const filename = resolveLlamaCacheFilename(opts.modelUri);
  const modelPath = path.join(opts.cacheDir, filename);

  let cached = false;
  try {
    await access(modelPath);
    cached = true;
  } catch {
    cached = false;
  }

  return { cached, cacheDir: opts.cacheDir, filename };
}

async function defaultDownloader(opts: { modelUri: string; cacheDir: string; filename: string; onProgress?: (status: { totalSize: number; downloadedSize: number }) => void }): Promise<string> {
  // Dynamic import to avoid loading native addon at module load time
  const { resolveModelFile } = await import('node-llama-cpp');

  const resolvedPath = await resolveModelFile(opts.modelUri, {
    directory: opts.cacheDir,
    download: 'auto',
    cli: false,
    fileName: opts.filename,
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
  });

  return resolvedPath;
}
