export type VoyageInputType = 'document' | 'query';

export interface VoyageEmbeddingClientOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  endpoint?: string;
  timeoutMs?: number;
}

export interface EmbedBatchOptions {
  inputType: VoyageInputType;
}

interface VoyageEmbeddingDataItem {
  embedding?: unknown;
}

interface VoyageEmbeddingResponse {
  data?: unknown;
  embeddings?: unknown;
  total_tokens?: number;
}

export class VoyageEmbeddingClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: VoyageEmbeddingClientOptions) {
    this.endpoint = options.endpoint ?? 'https://api.voyageai.com/v1/embeddings';
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async embed(inputs: readonly string[], options: EmbedBatchOptions): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input: inputs.length === 1 ? inputs[0] : inputs,
          model: this.options.model,
          input_type: options.inputType,
          truncation: true,
          output_dimension: this.options.dimensions,
          output_dtype: 'float',
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      const parsed = parseJson(raw);

      if (!response.ok) {
        throw new Error(`Voyage embedding request failed (${response.status}): ${extractVoyageError(parsed) ?? raw.slice(0, 500)}`);
      }

      const embeddings = extractEmbeddings(parsed);
      if (embeddings.length !== inputs.length) {
        throw new Error(`Voyage returned ${embeddings.length} embeddings for ${inputs.length} inputs.`);
      }

      for (const [index, embedding] of embeddings.entries()) {
        if (embedding.length !== this.options.dimensions) {
          throw new Error(`Voyage embedding ${index} has ${embedding.length} dimensions; expected ${this.options.dimensions}.`);
        }
      }

      return embeddings;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Voyage embedding request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJson(raw: string): VoyageEmbeddingResponse {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as VoyageEmbeddingResponse : {};
  } catch {
    return {};
  }
}

function extractEmbeddings(response: VoyageEmbeddingResponse): number[][] {
  if (Array.isArray(response.embeddings)) {
    return response.embeddings.map(coerceEmbedding);
  }

  if (Array.isArray(response.data)) {
    return response.data.map((item) => coerceEmbedding((item as VoyageEmbeddingDataItem).embedding));
  }

  throw new Error('Voyage response did not include embeddings.');
}

function coerceEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Voyage response contained a non-array embedding.');
  }

  return value.map((item, index) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error(`Voyage response contained a non-numeric embedding value at index ${index}.`);
    }
    return item;
  });
}

function extractVoyageError(response: VoyageEmbeddingResponse): string | null {
  const candidate = response as Record<string, unknown>;
  const detail = candidate.error ?? candidate.detail ?? candidate.message;

  if (typeof detail === 'string') {
    return detail;
  }

  if (detail && typeof detail === 'object') {
    const message = (detail as Record<string, unknown>).message;
    return typeof message === 'string' ? message : JSON.stringify(detail).slice(0, 500);
  }

  return null;
}
