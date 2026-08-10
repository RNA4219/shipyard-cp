import type { StateTransitionEvent } from '../types.js';
import { InMemoryBackend, type StoreBackend } from './store-backend.js';
import { RedisBackend } from './redis-backend.js';

/** Asynchronous persistence contract for all Control Plane records. */
export interface ControlPlaneRepository extends StoreBackend {
  replaceEvents(taskId: string, events: StateTransitionEvent[]): Promise<void>;
  setRecord(kind: string, id: string, value: unknown, ttlSeconds?: number): Promise<void>;
  getRecord<T>(kind: string, id: string): Promise<T | null>;
  listRecords<T>(kind: string): Promise<T[]>;
  deleteRecord(kind: string, id: string): Promise<void>;
  close(): Promise<void>;
}

/** Development and unit-test repository. */
export class InMemoryControlPlaneRepository extends InMemoryBackend implements ControlPlaneRepository {}

/** Production repository backed by the Redis v2 namespace. */
export class RedisControlPlaneRepository extends RedisBackend implements ControlPlaneRepository {}
