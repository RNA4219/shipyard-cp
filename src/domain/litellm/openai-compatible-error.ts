const PREFIX = 'OPENAI_COMPATIBLE_';

/** Maps provider-specific failures to a secret-safe OpenAI-compatible error code. */
export function normalizeOpenAICompatibleError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(PREFIX)) return error instanceof Error ? error : new Error(message);
  const lower = message.toLowerCase();
  if (error instanceof Error && error.name === 'AbortError' || lower.includes('timeout') || lower.includes('timed out')) {
    return new Error(`${PREFIX}TIMEOUT`);
  }
  if (error instanceof SyntaxError || lower.includes('invalid json') || lower.includes('unexpected token')) {
    return new Error(`${PREFIX}INVALID_JSON`);
  }
  if (lower.includes('empty choices') || lower.includes('missing choices')) {
    return new Error(`${PREFIX}EMPTY_CHOICES`);
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return new Error(`${PREFIX}AUTH_FAILED`);
  }
  if (lower.includes('404') || lower.includes('model not found') || lower.includes('does not exist')) {
    return new Error(`${PREFIX}MODEL_NOT_FOUND`);
  }
  if (lower.includes('context') || lower.includes('maximum tokens') || lower.includes('too many tokens')) {
    return new Error(`${PREFIX}CONTEXT_LENGTH_EXCEEDED`);
  }
  if (/\b5\d\d\b/.test(lower) || lower.includes('server error')) {
    return new Error(`${PREFIX}UPSTREAM_5XX`);
  }
  return new Error(`${PREFIX}REQUEST_FAILED`);
}
