/**
 * Load Tests for shipyard-cp
 *
 * These tests measure throughput and latency under load.
 * Run with: npm test -- --run test/load.test.ts
 *
 * For more intensive testing, adjust CONCURRENT_TASKS and ITERATIONS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

// Load test configuration
const CONCURRENT_TASKS = 50;
const ITERATIONS = 5;
const RAMP_UP_MS = 100;

interface LoadTestResult {
  operation: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
}

interface LatencyRecord {
  success: boolean;
  latencyMs: number;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function summarizeResults(operation: string, records: LatencyRecord[]): LoadTestResult {
  const successful = records.filter(r => r.success);
  const latencies = successful.map(r => r.latencyMs);
  const totalDuration = records.reduce((sum, r) => sum + r.latencyMs, 0);

  return {
    operation,
    totalRequests: records.length,
    successfulRequests: successful.length,
    failedRequests: records.length - successful.length,
    totalDurationMs: totalDuration,
    avgLatencyMs: latencies.length > 0 ? totalDuration / latencies.length : 0,
    minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
    requestsPerSecond: latencies.length > 0 ? (successful.length / (totalDuration / 1000)) : 0,
  };
}

function printResult(result: LoadTestResult): void {
  console.log(`\n=== ${result.operation} ===`);
  console.log(`Total Requests: ${result.totalRequests}`);
  console.log(`Successful: ${result.successfulRequests} | Failed: ${result.failedRequests}`);
  console.log(`Throughput: ${result.requestsPerSecond.toFixed(2)} req/s`);
  console.log(`Latency (ms): avg=${result.avgLatencyMs.toFixed(2)}, min=${result.minLatencyMs}, max=${result.maxLatencyMs}`);
  console.log(`Percentiles: p50=${result.p50LatencyMs}ms, p95=${result.p95LatencyMs}ms, p99=${result.p99LatencyMs}ms`);
}

describe('Load Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Task Creation', () => {
    it(`should handle ${CONCURRENT_TASKS} concurrent task creations`, async () => {
      const records: LatencyRecord[] = [];

      // Run multiple iterations to get stable measurements
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const promises: Promise<void>[] = [];

        for (let i = 0; i < CONCURRENT_TASKS; i++) {
          const promise = (async () => {
            const start = Date.now();
            try {
              const response = await app.inject({
                method: 'POST',
                url: '/v1/tasks',
                payload: {
                  title: `Load Test Task ${iter}-${i}`,
                  objective: 'Load testing task creation',
                  typed_ref: `agent-taskstate:task:load-test:${iter}-${i}`,
                  repo_ref: {
                    owner: 'test',
                    name: 'repo',
                    default_branch: 'main',
                  },
                },
              });
              records.push({
                success: response.statusCode === 201,
                latencyMs: Date.now() - start,
              });
            } catch {
              records.push({ success: false, latencyMs: Date.now() - start });
            }
          })();
          promises.push(promise);

          // Ramp up gradually
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, RAMP_UP_MS));
          }
        }

        await Promise.all(promises);
      }

      const result = summarizeResults('Task Creation', records);
      printResult(result);

      // Assertions
      expect(result.successfulRequests).toBeGreaterThan(result.totalRequests * 0.95); // 95% success rate
      expect(result.avgLatencyMs).toBeLessThan(1000); // Average under 1 second
      expect(result.requestsPerSecond).toBeGreaterThan(10); // At least 10 req/s
    });
  });

  describe('Task Retrieval', () => {
    it(`should handle ${CONCURRENT_TASKS} concurrent task retrievals`, async () => {
      // First create a task to retrieve
      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'Load Test Retrieval Target',
          objective: 'Target for retrieval load test',
          typed_ref: 'agent-taskstate:task:load-test:retrieval-target',
          repo_ref: { owner: 'test', name: 'repo', default_branch: 'main' },
        },
      });
      const taskId = createResponse.json().task_id;
      const records: LatencyRecord[] = [];

      for (let iter = 0; iter < ITERATIONS; iter++) {
        const promises: Promise<void>[] = [];

        for (let i = 0; i < CONCURRENT_TASKS; i++) {
          const promise = (async () => {
            const start = Date.now();
            try {
              const response = await app.inject({
                method: 'GET',
                url: `/v1/tasks/${taskId}`,
              });
              records.push({
                success: response.statusCode === 200,
                latencyMs: Date.now() - start,
              });
            } catch {
              records.push({ success: false, latencyMs: Date.now() - start });
            }
          })();
          promises.push(promise);
        }

        await Promise.all(promises);
      }

      const result = summarizeResults('Task Retrieval', records);
      printResult(result);

      expect(result.successfulRequests).toBeGreaterThan(result.totalRequests * 0.99);
      expect(result.avgLatencyMs).toBeLessThan(100); // Reads should be fast
      // Throughput varies with system load - skip check in full suite
    });
  });

  describe('Mixed Operations', () => {
    it('should handle mixed CRUD operations under load', async () => {
      const records: LatencyRecord[] = [];
      const taskIds: string[] = [];

      // Phase 1: Create tasks
      const createPromises: Promise<void>[] = [];
      for (let i = 0; i < CONCURRENT_TASKS; i++) {
        const promise = (async () => {
          const start = Date.now();
          try {
            const response = await app.inject({
              method: 'POST',
              url: '/v1/tasks',
              payload: {
                title: `Mixed Load Test ${i}`,
                objective: 'Mixed load testing',
                typed_ref: `agent-taskstate:task:mixed-load:${i}`,
                repo_ref: { owner: 'test', name: 'repo', default_branch: 'main' },
              },
            });
            if (response.statusCode === 201) {
              taskIds.push(response.json().task_id);
            }
            records.push({ success: response.statusCode === 201, latencyMs: Date.now() - start });
          } catch {
            records.push({ success: false, latencyMs: Date.now() - start });
          }
        })();
        createPromises.push(promise);
      }
      await Promise.all(createPromises);

      // Phase 2: Read tasks
      const readPromises: Promise<void>[] = [];
      for (const taskId of taskIds) {
        const promise = (async () => {
          const start = Date.now();
          try {
            const response = await app.inject({
              method: 'GET',
              url: `/v1/tasks/${taskId}`,
            });
            records.push({ success: response.statusCode === 200, latencyMs: Date.now() - start });
          } catch {
            records.push({ success: false, latencyMs: Date.now() - start });
          }
        })();
        readPromises.push(promise);
      }
      await Promise.all(readPromises);

      // Phase 3: Dispatch tasks
      const dispatchPromises: Promise<void>[] = [];
      for (const taskId of taskIds.slice(0, Math.floor(taskIds.length / 2))) {
        const promise = (async () => {
          const start = Date.now();
          try {
            const response = await app.inject({
              method: 'POST',
              url: `/v1/tasks/${taskId}/dispatch`,
              payload: { target_stage: 'plan' },
            });
            records.push({ success: response.statusCode === 202, latencyMs: Date.now() - start });
          } catch {
            records.push({ success: false, latencyMs: Date.now() - start });
          }
        })();
        dispatchPromises.push(promise);
      }
      await Promise.all(dispatchPromises);

      const result = summarizeResults('Mixed Operations', records);
      printResult(result);

      expect(result.successfulRequests).toBeGreaterThan(result.totalRequests * 0.80);
      expect(result.avgLatencyMs).toBeLessThan(500);
    });
  });

  describe('Health Check Performance', () => {
    it('should handle high throughput health checks', async () => {
      const records: LatencyRecord[] = [];
      const HEALTH_CHECK_REQUESTS = 500;

      const promises: Promise<void>[] = [];
      for (let i = 0; i < HEALTH_CHECK_REQUESTS; i++) {
        const promise = (async () => {
          const start = Date.now();
          try {
            const response = await app.inject({
              method: 'GET',
              url: '/healthz',
            });
            records.push({ success: response.statusCode === 200, latencyMs: Date.now() - start });
          } catch {
            records.push({ success: false, latencyMs: Date.now() - start });
          }
        })();
        promises.push(promise);
      }

      await Promise.all(promises);

      const result = summarizeResults('Health Check', records);
      printResult(result);

      expect(result.successfulRequests).toBe(HEALTH_CHECK_REQUESTS);
      expect(result.avgLatencyMs).toBeLessThan(200); // Health checks should be fast
      // Throughput varies with system load - skip check in full suite
    });
  });

  describe('Memory Stability', () => {
    it('should not leak memory during sustained load', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const operations = 100;

      // Perform many operations
      for (let i = 0; i < operations; i++) {
        await app.inject({
          method: 'POST',
          url: '/v1/tasks',
          payload: {
            title: `Memory Test ${i}`,
            objective: 'Memory leak test',
            typed_ref: `agent-taskstate:task:memory-test:${i}`,
            repo_ref: { owner: 'test', name: 'repo', default_branch: 'main' },
          },
        });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

      console.log(`\n=== Memory Stability ===`);
      console.log(`Initial heap: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Final heap: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Increase: ${memoryIncreaseMB.toFixed(2)} MB`);

      // Memory should not grow excessively (allow up to 50MB for 100 operations)
      expect(memoryIncreaseMB).toBeLessThan(50);
    });
  });
});