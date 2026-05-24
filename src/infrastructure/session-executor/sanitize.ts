const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Keep upstream HTTP bodies safe for exception messages and logs.
 */
export function sanitizeUpstreamErrorBody(body: string, maxLength = 240): string {
  const normalized = body.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

