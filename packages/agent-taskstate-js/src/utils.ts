/**
 * Shared utility functions for agent-taskstate-js
 */

/**
 * Generate a unique ID (no prefix)
 * Use prefixed versions for specific entity types if needed
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}