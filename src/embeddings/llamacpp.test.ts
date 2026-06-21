import { describe, expect, it } from 'vitest';
import { LlamaCppEmbeddingClient, type EmbeddingContextLike } from './llamacpp.js';
import { formatForEmbedding } from './ollama.js';

const DIMENSIONS = 768;
const MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
// formatModelName derived from the URI filename (without .gguf extension)
const FORMAT_MODEL_NAME = 'embeddinggemma-300M-Q8_0';

function makeVector(dims = DIMENSIONS): number[] {
  return Array.from({ length: dims }, (_, i) => (i + 1) / dims);
}

function makeStubContext(dims = DIMENSIONS): EmbeddingContextLike {
  return {
    getEmbeddingFor: async (_input: string) => ({
      vector: makeVector(dims) as readonly number[],
    }),
  };
}

describe('LlamaCppEmbeddingClient.embed', () => {
  it('returns empty array for empty input', async () => {
    const client = new LlamaCppEmbeddingClient({
      model: MODEL_URI,
      modelUri: MODEL_URI,
      dimensions: DIMENSIONS,
      contextFactory: async () => makeStubContext(),
    });

    const result = await client.embed([], { inputType: 'query' });
    expect(result).toEqual([]);
  });

  it('applies formatForEmbedding prefixes for query input (QMD nomic-style)', async () => {
    const capturedInputs: string[] = [];
    const ctx: EmbeddingContextLike = {
      getEmbeddingFor: async (input: string) => {
        capturedInputs.push(input);
        return { vector: makeVector() as readonly number[] };
      },
    };

    const client = new LlamaCppEmbeddingClient({
      model: MODEL_URI,
      modelUri: MODEL_URI,
      dimensions: DIMENSIONS,
      contextFactory: async () => ctx,
    });

    await client.embed(['find recall session'], { inputType: 'query' });

    const expected = formatForEmbedding('find recall session', 'query', FORMAT_MODEL_NAME);
    expect(capturedInputs[0]).toBe(expected);
    // Verify the prefix is the nomic-style QMD format
    expect(capturedInputs[0]).toBe('task: search result | query: find recall session');
  });

  it('applies formatForEmbedding prefixes for document input (QMD nomic-style)', async () => {
    const capturedInputs: string[] = [];
    const ctx: EmbeddingContextLike = {
      getEmbeddingFor: async (input: string) => {
        capturedInputs.push(input);
        return { vector: makeVector() as readonly number[] };
      },
    };

    const client = new LlamaCppEmbeddingClient({
      model: MODEL_URI,
      modelUri: MODEL_URI,
      dimensions: DIMENSIONS,
      contextFactory: async () => ctx,
    });

    await client.embed(['chunk text content'], { inputType: 'document' });

    const expected = formatForEmbedding('chunk text content', 'document', FORMAT_MODEL_NAME);
    expect(capturedInputs[0]).toBe(expected);
    expect(capturedInputs[0]).toBe('title: none | text: chunk text content');
  });

  it('returns number[][] with correct count and dimensions for multiple inputs', async () => {
    const client = new LlamaCppEmbeddingClient({
      model: MODEL_URI,
      modelUri: MODEL_URI,
      dimensions: DIMENSIONS,
      contextFactory: async () => makeStubContext(),
    });

    const inputs = ['query one', 'query two', 'query three'];
    const result = await client.embed(inputs, { inputType: 'query' });

    expect(result).toHaveLength(3);
    for (const vec of result) {
      expect(vec).toHaveLength(DIMENSIONS);
      expect(vec.every((v) => typeof v === 'number')).toBe(true);
    }
  });

  it('throws on dimension mismatch', async () => {
    const wrongDims = 512;
    const client = new LlamaCppEmbeddingClient({
      model: MODEL_URI,
      modelUri: MODEL_URI,
      dimensions: DIMENSIONS,
      contextFactory: async () => makeStubContext(wrongDims),
    });

    await expect(client.embed(['some text'], { inputType: 'document' })).rejects.toThrow(
      /dimensions/i,
    );
  });
});
