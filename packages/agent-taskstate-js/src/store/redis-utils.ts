/**
 * Shared Redis connection utilities
 *
 * Handles ESM/CJS interop for ioredis dynamic import
 */

/**
 * Redis client interface (compatible with ioredis)
 * Defines the minimal interface needed by all backends
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  rpush(key: string, ...values: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  quit(): Promise<void>;
}

/**
 * Configuration for Redis connection
 */
export interface RedisConnectionConfig {
  url?: string;
  client?: RedisClientLike;
}

/**
 * Get or create a Redis client
 *
 * Handles the ESM/CJS interop issue with ioredis dynamic import.
 * Returns the existing client if already connected, or creates a new one.
 *
 * @param existingClient - Current client (may be null)
 * @param config - Connection configuration
 * @returns The Redis client
 */
export async function getOrCreateRedisClient(
  existingClient: RedisClientLike | null,
  config: RedisConnectionConfig
): Promise<RedisClientLike> {
  // Return existing client if available
  if (existingClient) {
    return existingClient;
  }

  // Use provided client from config
  if (config.client) {
    return config.client;
  }

  // Dynamic import to handle ESM/CJS interop
  const ioredis = await import('ioredis');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Redis = (ioredis as any).default || ioredis;
  return new Redis(config.url ?? 'redis://localhost:6379');
}