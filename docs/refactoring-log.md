# TDD Refactoring Log

**Date:** 2026-03-17
**Approach:** Test-Driven Development (Red → Green → Refactor)

---

## Summary

| Domain | Tests Added | Status |
|--------|-------------|--------|
| state-machine | 18 | ✅ |
| task-validator | 15 | ✅ |
| worker-policy | 13 | ✅ |
| resolver-service | 9 | ✅ |
| tracker-service | 12 | ✅ |
| Existing tests | 37 | ✅ |
| **Total** | **104** | ✅ |

---

## Domain Structure

```
src/domain/
├── state-machine/
│   ├── types.ts          - TaskState, WorkerStage, TERMINAL_STATES
│   ├── state-machine.ts  - StateMachine class
│   └── index.ts
├── task/
│   ├── task-validator.ts - TaskValidator class
│   └── index.ts
├── worker/
│   ├── worker-policy.ts  - WorkerPolicy class
│   └── index.ts
├── resolver/
│   ├── resolver-service.ts - ResolverService class
│   └── index.ts
└── tracker/
    ├── tracker-service.ts - TrackerService class
    └── index.ts
```

---

## Extracted Logic

### StateMachine
- `ALLOWED_TRANSITIONS` map
- `canTransition(from, to)`
- `validateTransition(from, to)`
- `getAllowedDispatchStage(state)`
- `stageToActiveState(stage)`
- `isTerminal(state)`

### TaskValidator
- `validateObjective(objective)`
- `validateTypedRef(typedRef)`
- `validateCreateRequest(request)`
- `TYPED_REF_PATTERN`

### WorkerPolicy
- `getDefaultWorker(stage)`
- `buildApprovalPolicy(stage, risk)`
- `getCapabilityRequirements(stage)`
- `getRequestedOutputs(stage)`

### ResolverService
- `resolveDocs(typedRef, request)`
- `buildAckRef(taskId, docId, version)`

### TrackerService
- `parseEntityRef(entityRef, connectionRef)`
- `generateSyncEventRef(taskId)`
- `buildSyncEventRef(value, connectionRef)`
- `mergeExternalRefs(existing, newRefs)`

---

## control-plane-store.ts Reduction

| Metric | Before | After |
|--------|--------|-------|
| Lines | ~740 | ~560 |
| Functions | 15 | 8 |
| Responsibilities | Mixed | Orchestrator only |

---

## Test Coverage by Domain

```
state-machine.test.ts      - 18 tests
  - getAllowedTransitions (5 tests)
  - canTransition (2 tests)
  - validateTransition (2 tests)
  - getAllowedDispatchStage (4 tests)
  - stageToActiveState (3 tests)
  - isTerminal (2 tests)

task-validator.test.ts    - 15 tests
  - validateObjective (4 tests)
  - validateTypedRef (7 tests)
  - validateCreateRequest (4 tests)

worker-policy.test.ts     - 13 tests
  - getDefaultWorker (3 tests)
  - buildApprovalPolicy (3 tests)
  - getCapabilityRequirements (3 tests)
  - getRequestedOutputs (3 tests)

resolver-service.test.ts  - 9 tests
  - resolveDocs (7 tests)
  - buildAckRef (2 tests)

tracker-service.test.ts   - 12 tests
  - parseEntityRef (6 tests)
  - generateSyncEventRef (2 tests)
  - buildSyncEventRef (1 test)
  - mergeExternalRefs (3 tests)
```

---

## All Tests Passing

```
✓ test/state-machine.test.ts (18 tests)
✓ test/task-validator.test.ts (15 tests)
✓ test/worker-policy.test.ts (13 tests)
✓ test/resolver-service.test.ts (9 tests)
✓ test/tracker-service.test.ts (12 tests)
✓ test/task.test.ts (7 tests)
✓ test/resolver.test.ts (5 tests)
✓ test/tracker.test.ts (5 tests)
✓ test/worker.test.ts (7 tests)
✓ test/full-flow.test.ts (3 tests)
✓ test/integrate-publish.test.ts (10 tests)

Test Files: 11 passed
Tests: 104 passed
```

---

## Manual Verification (2026-03-17)

Full lifecycle verified with live server:

```
1. Create Task → queued ✅
2. Resolve Docs → doc_refs returned ✅
3. Link Tracker → external_refs, sync_event_ref ✅
4. Dispatch Plan → worker_type: codex, approval_policy: deny ✅
5. Plan Result → state: planned ✅
6. Dispatch Dev → operator_approval_required: true (high risk) ✅
7. Dev Result → state: dev_completed ✅
8. Dispatch Acceptance ✅
9. Acceptance Result (with regression) → state: accepted ✅
10. Integrate → state: integrating ✅
11. Complete Integrate → state: integrated ✅
12. Publish → state: publish_pending_approval ✅
13. Approve Publish → state: publishing ✅
14. Complete Publish → state: published ✅

Final: state=published, completed_at set, 12 events recorded
Invalid transition (published → queued) correctly rejected with 409
```