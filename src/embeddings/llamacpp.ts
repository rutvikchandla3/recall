import type { EmbeddingClient, EmbedBatchOptions } from './client.js';
import { formatForEmbedding } from './ollama.js';

export interface LlamaCppEmbeddingClientOptions {
  /** Resolved local GGUF path (after download) */
  model: string;
  /** Original model URI (hf: URI or path) — used for formatForEmbedding model name detection */
  modelUri: string;
  dimensions: number;
  /** Override the model name passed to formatForEmbedding (defaults to derived from modelUri) */
  formatModelName?: string;
  gpu?: 'auto' | false;
  /** Injectable context factory for testing — skips native node-llama-cpp load */
  contextFactory?: () => Promise<EmbeddingContextLike>;
  logger?: { info(msg: string): void; warn(msg: string): void };
}

export interface EmbeddingContextLike {
  getEmbeddingFor(input: string): Promise<{ vector: readonly number[] }>;
  dispose?(): Promise<void>;
}

/**
 * In-process llama.cpp embedding client using node-llama-cpp.
 * Loads the GGUF model lazily on first embed() call.
 * Reuses formatForEmbedding (QMD-compatible prefixes) from ollama.ts.
 */
export class LlamaCppEmbeddingClient implements EmbeddingClient {
  private readonly options: LlamaCppEmbeddingClientOptions;
  private context: EmbeddingContextLike | null = null;
  private initPromise: Promise<void> | null = null;
  private warnedCpu = false;

  constructor(options: LlamaCppEmbeddingClientOptions) {
    this.options = options;
  }

  private get formatModelName(): string {
    if (this.options.formatModelName) {
      return this.options.formatModelName;
    }
    // Derive a usable model name from the URI for formatForEmbedding prefix detection.
    // The hf: URI contains 'embeddinggemma' which usesNomicStyleFormat() will match.
    const uri = this.options.modelUri;
    const filename = uri.split('/').at(-1) ?? uri;
    // Strip the .gguf extension for cleaner name
    return filename.replace(/\.gguf$/i, '');
  }

  private async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (this.options.contextFactory) {
        this.context = await this.options.contextFactory();
        return;
      }

      // Dynamic import: keeps the CLI fast for non-semantic commands
      const { getLlama } = await import('node-llama-cpp');

      const gpu = this.options.gpu ?? 'auto';
      const llama = await getLlama({ gpu });

      if (llama.gpu === false && !this.warnedCpu) {
        this.warnedCpu = true;
        this.options.logger?.warn(
          'Running embeddings on CPU; first sync may be slow. Run `recall doctor` for details.',
        );
      }

      const model = await llama.loadModel({ modelPath: this.options.model });
      const embCtx = await model.createEmbeddingContext();

      this.context = {
        getEmbeddingFor: (input: string) => embCtx.getEmbeddingFor(input),
        dispose: () => embCtx.dispose(),
      };
    })();

    return this.initPromise;
  }

  async embed(inputs: readonly string[], options: EmbedBatchOptions): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    await this.init();
    const ctx = this.context;
    if (!ctx) {
      throw new Error('LlamaCppEmbeddingClient: context not initialized.');
    }

    const modelName = this.formatModelName;
    const results: number[][] = [];

    for (const input of inputs) {
      const formatted = formatForEmbedding(input, options.inputType, modelName);
      const embedding = await ctx.getEmbeddingFor(formatted);
      const vector = Array.from(embedding.vector);

      if (vector.length !== this.options.dimensions) {
        throw new Error(
          `LlamaCpp embedding has ${vector.length} dimensions; expected ${this.options.dimensions}. Update embeddings.dimensions or run recall index --full after changing models.`,
        );
      }

      results.push(vector);
    }

    if (results.length !== inputs.length) {
      throw new Error(
        `LlamaCpp returned ${results.length} embeddings for ${inputs.length} inputs.`,
      );
    }

    return results;
  }

  async dispose(): Promise<void> {
    if (this.context?.dispose) {
      await this.context.dispose();
    }
    this.context = null;
    this.initPromise = null;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}
