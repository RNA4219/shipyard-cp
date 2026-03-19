# Performance Optimization Guide

This document records performance optimizations applied to shipyard-cp.

## Load Test Results (2026-03-20)

### Test Configuration

```typescript
const CONCURRENT_TASKS = 50;
const ITERATIONS = 5;
const RAMP_UP_MS = 100;
```

### Results Summary

| Test | Throughput | Avg Latency | P50 | P95 | P99 | Success Rate |
|------|------------|-------------|-----|-----|-----|--------------|
| Task Creation | 514 req/s | 2ms | 2ms | 4ms | 5ms | 100% |
| Task Retrieval | 211 req/s | 5ms | 5ms | 7ms | 9ms | 100% |
| Mixed Operations | 133 req/s | 7ms | 6ms | 10ms | 11ms | 96% |
| Health Check | 40 req/s | 25ms | 25ms | 26ms | 26ms | 100% |
| Memory Stability | - | - | - | - | - | No leaks |

## Optimizations Applied

### 1. Concurrency Limits

**File**: `src/domain/concurrency/types.ts`

**Before**:
```typescript
export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  max_concurrent_per_worker: 3,
  max_concurrent_global: 10,
};
```

**After**:
```typescript
export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  max_concurrent_per_worker: 20,
  max_concurrent_global: 200,
};
```

**Impact**: Allows higher parallelism for concurrent task processing.

### 2. RedisBackend N+1 Query Elimination

**File**: `src/store/redis-backend.ts`

**Problem**: `listTasks()` made individual `GET` calls for each task ID.

**Solution**: Use `MGET` for batch fetching.

**Before**:
```typescript
for (const taskId of taskIds) {
  const task = await this.getTask(taskId);
  if (task) tasks.push(task);
}
```

**After**:
```typescript
const keys = taskIds.map(id => this.taskKey(id));
const results = await this.client.mget(...keys);
// Parse all results in single pass
```

**Impact**: Reduced O(n) individual queries to O(1) batch query.

### 3. Job Index by Task ID

**File**: `src/store/redis-backend.ts`, `src/store/store-backend.ts`

**Problem**: `listJobsByTask()` scanned all jobs to find matches.

**Solution**: Maintain a reverse index using Redis Sets.

**RedisBackend**:
```typescript
// On setJob
await this.client.sadd(this.jobsByTaskKey(job.task_id), job.job_id);

// On listJobsByTask
const jobIds = await this.client.smembers(this.jobsByTaskKey(taskId));
const results = await this.client.mget(...jobIds.map(id => this.jobKey(id)));
```

**InMemoryBackend**:
```typescript
private readonly jobsByTask = new Map<string, Set<string>>();
```

**Impact**: O(n) scan reduced to O(1) lookup.

## Performance Metrics

### Before Optimizations

| Metric | Value |
|--------|-------|
| Mixed Operations Success Rate | 82% |
| Task Creation Throughput | 472 req/s |
| Task Retrieval Throughput | 195 req/s |

### After Optimizations

| Metric | Value | Improvement |
|--------|-------|-------------|
| Mixed Operations Success Rate | 96% | +14% |
| Task Creation Throughput | 514 req/s | +9% |
| Task Retrieval Throughput | 211 req/s | +8% |

## Running Load Tests

```bash
# Run load tests
npm test -- --run test/load.test.ts

# Run with garbage collection exposed
node --expose-gc node_modules/.bin/vitest run test/load.test.ts
```

## Monitoring Performance

### Prometheus Metrics

The `/metrics` endpoint exposes:

- `shipyard_tasks_created_total` - Total tasks created
- `shipyard_jobs_dispatched_total` - Total jobs dispatched
- `shipyard_http_request_duration_seconds` - HTTP latency histogram

### Redis Latency

```bash
redis-cli --latency
```

### Memory Usage

```bash
# Check Redis memory
redis-cli info memory

# Check Node.js memory
curl http://localhost:3000/health | jq '.memory'
```

## Future Optimizations

### Potential Improvements

1. **Connection Pooling**: Reuse Redis connections
2. **Pipelining**: Batch Redis commands
3. **Caching**: Cache frequently accessed tasks
4. **Compression**: Compress large task payloads
5. **Sharding**: Distribute load across Redis instances

### Capacity Planning

For production deployment:

| Workers | Recommended Config |
|---------|-------------------|
| 1-5 | max_concurrent_per_worker: 20, max_concurrent_global: 100 |
| 5-20 | max_concurrent_per_worker: 20, max_concurrent_global: 200 |
| 20+ | Consider horizontal scaling with shared Redis |

## Related Documents

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment configuration
- [RUNBOOK.md](../RUNBOOK.md) - Operational procedures
- [test/load.test.ts](../test/load.test.ts) - Load test implementation