export function embeddingToBuffer(values: readonly number[], expectedDimensions?: number): Buffer {
  if (expectedDimensions !== undefined && values.length !== expectedDimensions) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDimensions}, got ${values.length}`);
  }

  const vector = new Float32Array(values.length);
  for (const [index, value] of values.entries()) {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding contains a non-finite value at index ${index}`);
    }
    vector[index] = value;
  }

  return Buffer.from(vector.buffer);
}

export function bufferToEmbedding(buffer: Buffer): Float32Array {
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Invalid embedding buffer length: ${buffer.byteLength}`);
  }

  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
}
