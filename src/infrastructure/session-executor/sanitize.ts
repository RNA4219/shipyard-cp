function replaceControlChars(value: string): string {
  return Array.from(value, char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');
}

/**
 * Keep upstream HTTP bodies safe for exception messages and logs.
 */
export function sanitizeUpstreamErrorBody(body: string, maxLength = 240): string {
  const normalized = replaceControlChars(body).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}
