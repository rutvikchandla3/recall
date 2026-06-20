import { describe, expect, it } from 'vitest';
import { redactForEmbedding } from './redact.js';

describe('redactForEmbedding', () => {
  it('redacts common secret shapes before outbound embedding', () => {
    const result = redactForEmbedding('Authorization: Bearer abc.def.ghi VOYAGE_API_KEY=pa-12345678901234567890');

    expect(result.text).toContain('<REDACTED_BEARER_TOKEN>');
    expect(result.text).toContain('<REDACTED_API_KEY>');
    expect(result.count).toBeGreaterThanOrEqual(2);
  });
});
