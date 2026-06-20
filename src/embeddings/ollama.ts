export interface OllamaEmbeddingClientOptions {
  model: string;
  dimensions: number;
  endpoint?: string;
  timeoutMs?: number;
}

export type OllamaEmbeddingInputType = 'document' | 'query';

export interface OllamaEmbedBatchOptions {
  inputType?: OllamaEmbeddingInputType;
}

interface OllamaEmbeddingDataItem {
  embedding?: unknown;
  index?: unknown;
}

interface OllamaEmbedResponse {
  embeddings?: unknown;
  embedding?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
}

interface OllamaTagsResponse {
  models?: unknown;
}

export interface OllamaReadiness {
  ok: boolean;
  message?: string;
  setup?: string[];
}

export class OllamaEmbeddingClient {
  private readonly baseUrl: string;
  private readonly embedEndpoint: string;
  private readonly tagsEndpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OllamaEmbeddingClientOptions) {
    this.baseUrl = normalizeOllamaBaseUrl(options.endpoint ?? 'http://127.0.0.1:11434');
    this.embedEndpoint = `${this.baseUrl}/api/embed`;
    this.tagsEndpoint = `${this.baseUrl}/api/tags`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async checkReady(): Promise<OllamaReadiness> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 3_000));

    try {
      const response = await fetch(this.tagsEndpoint, { signal: controller.signal });
      const raw = await response.text();
      const parsed = parseJson(raw) as OllamaTagsResponse;

      if (!response.ok) {
        return {
          ok: false,
          message: `Ollama is reachable at ${this.baseUrl}, but /api/tags returned ${response.status}: ${extractOllamaError(parsed) ?? raw.slice(0, 300)}`,
          setup: ollamaSetupCommands(this.options.model),
        };
      }

      const modelNames = extractModelNames(parsed);
      if (!hasModel(modelNames, this.options.model)) {
        return {
          ok: false,
          message: `Ollama model "${this.options.model}" is not installed locally.`,
          setup: [`ollama pull ${this.options.model}`],
        };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: `Ollama is not reachable at ${this.baseUrl}: ${formatError(error)}`,
        setup: ollamaSetupCommands(this.options.model),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(inputs: readonly string[], options: OllamaEmbedBatchOptions = {}): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const formattedInputs = inputs.map((input) => formatForEmbedding(input, options.inputType ?? 'document', this.options.model));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.embedEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: formattedInputs.length === 1 ? formattedInputs[0] : formattedInputs,
          truncate: true,
          dimensions: this.options.dimensions,
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      const parsed = parseJson(raw) as OllamaEmbedResponse;

      if (!response.ok) {
        throw new Error(`Ollama embedding request failed (${response.status}): ${extractOllamaError(parsed) ?? raw.slice(0, 500)}`);
      }

      const embeddings = extractEmbeddings(parsed);
      if (embeddings.length !== inputs.length) {
        throw new Error(`Ollama returned ${embeddings.length} embeddings for ${inputs.length} inputs.`);
      }

      for (const [index, embedding] of embeddings.entries()) {
        if (embedding.length !== this.options.dimensions) {
          throw new Error(`Ollama embedding ${index} has ${embedding.length} dimensions; expected ${this.options.dimensions}. Update embeddings.dimensions or run recall index --full after changing models.`);
        }
      }

      return embeddings;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Ollama embedding request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeOllamaBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  if (withScheme.endsWith('/api/embed')) {
    return withScheme.slice(0, -'/api/embed'.length);
  }

  if (withScheme.endsWith('/api/embeddings')) {
    return withScheme.slice(0, -'/api/embeddings'.length);
  }

  if (withScheme.endsWith('/api')) {
    return withScheme.slice(0, -'/api'.length);
  }

  return withScheme;
}

export function formatForEmbedding(text: string, inputType: OllamaEmbeddingInputType, model: string): string {
  if (isQwenEmbeddingModel(model)) {
    return inputType === 'query'
      ? `Instruct: Retrieve relevant documents for the given query\nQuery: ${text}`
      : text;
  }

  if (usesNomicStyleFormat(model)) {
    return inputType === 'query'
      ? `task: search result | query: ${text}`
      : `title: none | text: ${text}`;
  }

  return text;
}

export function ollamaSetupCommands(model: string): string[] {
  return [
    'Install Ollama from https://ollama.com/download (or `brew install ollama` on macOS).',
    'Start Ollama (`ollama serve` or the Ollama desktop app).',
    `Pull the embedding model: ollama pull ${model}`,
  ];
}

function isQwenEmbeddingModel(model: string): boolean {
  return /qwen.*embed/i.test(model) || /embed.*qwen/i.test(model);
}

function usesNomicStyleFormat(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes('embeddinggemma') || lower.includes('nomic');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function extractEmbeddings(response: OllamaEmbedResponse): number[][] {
  if (Array.isArray(response.embeddings)) {
    return response.embeddings.map(coerceEmbedding);
  }

  if (Array.isArray(response.embedding)) {
    return [coerceEmbedding(response.embedding)];
  }

  if (Array.isArray(response.data)) {
    return response.data
      .map((item) => item as OllamaEmbeddingDataItem)
      .sort((left, right) => coerceIndex(left.index) - coerceIndex(right.index))
      .map((item) => coerceEmbedding(item.embedding));
  }

  throw new Error('Ollama response did not include embeddings.');
}

function coerceEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Ollama response contained a non-array embedding.');
  }

  return value.map((item, index) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error(`Ollama response contained a non-numeric embedding value at index ${index}.`);
    }
    return item;
  });
}

function coerceIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function extractModelNames(response: OllamaTagsResponse): string[] {
  if (!Array.isArray(response.models)) {
    return [];
  }

  return response.models.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;
    return [record.name, record.model]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
  });
}

function hasModel(modelNames: readonly string[], configuredModel: string): boolean {
  const normalized = normalizeModelName(configuredModel);
  return modelNames.some((candidate) => {
    const candidateNormalized = normalizeModelName(candidate);
    return candidateNormalized === normalized
      || candidateNormalized === `${normalized}:latest`
      || `${candidateNormalized}:latest` === normalized;
  });
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function extractOllamaError(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const record = response as Record<string, unknown>;
  const detail = record.error ?? record.message;
  if (typeof detail === 'string') {
    return detail;
  }

  return detail && typeof detail === 'object' ? JSON.stringify(detail).slice(0, 500) : null;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'timed out';
  }

  return error instanceof Error ? error.message : String(error);
}
