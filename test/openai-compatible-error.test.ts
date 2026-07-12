import { describe, expect, it } from 'vitest';
import { normalizeOpenAICompatibleError } from '../src/domain/litellm/openai-compatible-error.js';

describe('OpenAI-compatible API error normalization', () => {
  it.each([
    ['401 unauthorized', 'OPENAI_COMPATIBLE_AUTH_FAILED'],
    ['HTTP 404 model does not exist', 'OPENAI_COMPATIBLE_MODEL_NOT_FOUND'],
    ['HTTP 400 context length exceeded', 'OPENAI_COMPATIBLE_CONTEXT_LENGTH_EXCEEDED'],
    ['HTTP 503 server error', 'OPENAI_COMPATIBLE_UPSTREAM_5XX'],
    ['empty choices', 'OPENAI_COMPATIBLE_EMPTY_CHOICES'],
    ['invalid JSON response', 'OPENAI_COMPATIBLE_INVALID_JSON'],
    ['request timed out', 'OPENAI_COMPATIBLE_TIMEOUT'],
  ])('maps %s to %s without echoing provider details', (source, expected) => {
    const error = normalizeOpenAICompatibleError(new Error(source));

    expect(error.message).toBe(expected);
    expect(error.message).not.toContain(source);
  });

  it('preserves a previously normalized code', () => {
    const error = normalizeOpenAICompatibleError(new Error('OPENAI_COMPATIBLE_AUTH_FAILED'));

    expect(error.message).toBe('OPENAI_COMPATIBLE_AUTH_FAILED');
  });
});
