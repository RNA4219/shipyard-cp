# shipyard-cp Birdeye

Birdeye is a knowledge map for navigating shipyard-cp documentation. Use this document for quick reference and document discovery.

## Project Status (2026-06-23)

| Priority | Status | Description |
|----------|--------|-------------|
| P0 | ✅ Complete | Production essentials: WorkerExecutor, ServiceHealthChecker, Auth, CI/CD |
| P1 | ✅ Complete | Feature completion: Failover, retry/failure_class integration, publish idempotency |
| P2 | ✅ Complete | Quality: Base SHA validation, branch prefix dynamic, log artifact validation |
| P3 | ✅ Complete | Type safety: All `any` types replaced with proper interfaces, 100% load test success |

### 2026-03-20 Progress
- **TD-012, TD-013, TD-017**: Resolved - Added proper TypeScript interfaces for SQLite/Redis backends
- **Load Tests**: Mixed Operations now 100% success (was 96%)
- **Type Safety**: Added row types, `nullToUndefined` helper, `RedisClientLike` interface
- **Code Quality**: Removed deprecated `.eslintignore`, unified ESLint config

### 2026-06-23 Progress
- **OpenCode-Compatible Worker Runtime**: Added session, event cursor, tool registry, stale registration rejection, and output bounding contracts.
- **QEG Evidence**: Recorded `standard` gate evidence for the OpenCode MIT porting slice with DQ 0, blocker 0, residual risk 0.
- **Documentation**: Added a release note and connected README, Runbook, OpenCode specification, Worker Runtime requirements, porting notes, and QEG evidence.

### 2026-07-12 Self-improvement Observation
- **Runtime producer**: canonical Auditから`self-improvement/v1`を再構築してexportする。
- **Evidence use**: GETではなく明示ackだけを観測する。
- **Review boundary**: workflow-cookbookが集計・提案の正本であり、shipyard-cpは自動policy変更を行わない。

## Hot List (Primary Entry Points)

| Priority | Document | Role | Description |
|----------|----------|------|-------------|
| 1 | [README.md](../README.md) | Overview | Project setup, implementation status, API summary |
| 2 | [RUNBOOK.md](./project/RUNBOOK.md) | Operations | Implementation procedures and progress tracking |
| 3 | [REQUIREMENTS.md](./project/REQUIREMENTS.md) | Requirements | Authoritative requirements definition |
| 4 | [OpenCode-Compatible Runtime Release](./releases/2026-06-23-opencode-compatible-runtime.md) | Release | OpenCode-compatible runtime change summary and validation |
| 5 | [WORKER_RUNTIME_SESSION_REQUIREMENTS.md](./project/WORKER_RUNTIME_SESSION_REQUIREMENTS.md) | Requirements | Session, event replay, tool registry, and bounded output contract |
| 6 | [OPENCODE_SPECIFICATION.md](./project/OPENCODE_SPECIFICATION.md) | Specification | OpenCode integration and Worker Runtime compatibility boundary |
| 7 | [docs/state-machine.md](./state-machine.md) | Specification | 16 states, transitions, guard conditions |
| 8 | [docs/api-contract.md](./api-contract.md) | Specification | API endpoints and validation rules |
| 9 | [docs/birdseye/index.json](./birdseye/index.json) | Navigation | Full node listings and edges |
| 10 | [INSTRUCTION_PRECISION_SPECIFICATION.md](./project/INSTRUCTION_PRECISION_SPECIFICATION.md) | Specification | Envelope伝達、共通renderer、欠落時拒否、legacy互換 |

## Quick Navigation

### Getting Started
1. [README.md](../README.md) - Project overview
2. [RUNBOOK.md](./project/RUNBOOK.md) - Implementation procedures
3. [docs/implementation-prep.md](./implementation-prep.md) - Pre-implementation checklist

### Implementation
1. [RUNBOOK.md](./project/RUNBOOK.md) - Step-by-step procedures
2. [INSTRUCTION_PRECISION_SPECIFICATION.md](./project/INSTRUCTION_PRECISION_SPECIFICATION.md) - Worker instruction delivery contract
3. [docs/state-machine.md](./state-machine.md) - State transitions
4. [docs/api-contract.md](./api-contract.md) - API definitions
5. [docs/openapi.yaml](./openapi.yaml) - OpenAPI schema

### OpenCode / Worker Runtime
1. [OpenCode-Compatible Runtime Release](./releases/2026-06-23-opencode-compatible-runtime.md) - Release-level summary
2. [OPENCODE_SPECIFICATION.md](./project/OPENCODE_SPECIFICATION.md) - OpenCode integration and compatibility boundary
3. [WORKER_RUNTIME_SESSION_REQUIREMENTS.md](./project/WORKER_RUNTIME_SESSION_REQUIREMENTS.md) - Worker Runtime session requirements
4. [OPENCODE_MIT_PORTING_NOTES.md](./project/OPENCODE_MIT_PORTING_NOTES.md) - OpenCode MIT concept mapping and exclusions
5. [QEG evidence README](./evidence/shipyard-opencode-mit-runtime-20260623/qeg/README.md) - Gate evidence entry point

### Instruction Precision
1. [INSTRUCTION_PRECISION_REQUIREMENTS.md](./project/INSTRUCTION_PRECISION_REQUIREMENTS.md) - Requirements and compatibility guarantees
2. [INSTRUCTION_PRECISION_SPECIFICATION.md](./project/INSTRUCTION_PRECISION_SPECIFICATION.md) - Prompt resolution and failure contract
3. [INSTRUCTION_PRECISION_DESIGN.md](./project/INSTRUCTION_PRECISION_DESIGN.md) - Shared renderer architecture and data flow
4. [docs/api-contract.md](./api-contract.md) - WorkerJob API contract
5. [docs/schemas/worker-job.schema.json](./schemas/worker-job.schema.json) - WorkerJob schema

### Execution Reliability
1. [docs/execution-reliability.md](./execution-reliability.md) - Retry, doom-loop, capability, concurrency
2. [docs/lock-and-lease.md](./lock-and-lease.md) - Lock, lease, heartbeat, orphan recovery
3. [docs/audit-events.md](./audit-events.md) - Audit event types

### Deployment
1. [docs/DEPLOYMENT.md](./DEPLOYMENT.md) - Production deployment
2. [RUNBOOK.md](./project/RUNBOOK.md) - Operational status

### Performance
1. [docs/performance.md](./performance.md) - Load test results and optimization guide

### Requirements
1. [REQUIREMENTS.md](./project/REQUIREMENTS.md) - Primary requirements
2. [ADD_REQUIREMENTS.md](./project/ADD_REQUIREMENTS.md) - Execution reliability supplements
3. [ADD_REQUIREMENTS_2.md](./project/ADD_REQUIREMENTS_2.md) - Visualization and retrospective
4. [ADD_REQUIREMENTS_3.md](./project/ADD_REQUIREMENTS_3.md) - Low-parameter model robustness strategy
5. [ADD_REQUIREMENTS_3_SPECIFICATION.md](./project/ADD_REQUIREMENTS_3_SPECIFICATION.md) - Low-parameter model protocol specification
6. [ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md](./project/ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md) - Implementation instructions for protocol hardening
7. [ADD_REQUIREMENTS_3_AGENT_INSTRUCTIONS.md](./project/ADD_REQUIREMENTS_3_AGENT_INSTRUCTIONS.md) - Agent-facing implementation instructions
8. [ADD_REQUIREMENTS_3_REMEDIATION_PLAN.md](./project/ADD_REQUIREMENTS_3_REMEDIATION_PLAN.md) - Post-acceptance remediation plan

## Document Roles

| Role | Description | Documents |
|------|-------------|-----------|
| **overview** | Project entry point | README.md |
| **operations** | Implementation and deployment | RUNBOOK.md, docs/DEPLOYMENT.md |
| **requirements** | Requirements definitions | REQUIREMENTS.md, ADD_REQUIREMENTS.md, ADD_REQUIREMENTS_2.md, ADD_REQUIREMENTS_3.md, INSTRUCTION_PRECISION_REQUIREMENTS.md, WORKER_RUNTIME_SESSION_REQUIREMENTS.md |
| **specification** | Technical specifications | docs/state-machine.md, docs/api-contract.md, docs/execution-reliability.md, docs/lock-and-lease.md, docs/audit-events.md, docs/openapi.yaml, docs/schemas/, ADD_REQUIREMENTS_3_SPECIFICATION.md, INSTRUCTION_PRECISION_SPECIFICATION.md, OPENCODE_SPECIFICATION.md |
| **design** | Implementation architecture | INSTRUCTION_PRECISION_DESIGN.md |
| **guide** | Implementation preparation | docs/implementation-prep.md, docs/performance.md, ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md |
| **release** | Release notes and validation summaries | docs/releases/2026-06-23-opencode-compatible-runtime.md |
| **evidence** | QEG and acceptance evidence | docs/evidence/shipyard-opencode-mit-runtime-20260623/qeg/ |

## Key Relationships (Edges)

### Source of Truth Chain
```
REQUIREMENTS.md
    ├── docs/state-machine.md (specifies)
    ├── docs/api-contract.md (specifies)
    └── docs/execution-reliability.md (specifies)

RUNBOOK.md
    ├── REQUIREMENTS.md (source_of_truth)
    ├── docs/state-machine.md (source_of_truth)
    ├── docs/api-contract.md (source_of_truth)
    └── INSTRUCTION_PRECISION_REQUIREMENTS/SPECIFICATION/DESIGN.md (references)
```

### Supplement Chain
```
ADD_REQUIREMENTS.md
    ├── REQUIREMENTS.md (extends)
    ├── docs/execution-reliability.md (defines)
    ├── docs/lock-and-lease.md (defines)
    └── docs/audit-events.md (defines)

ADD_REQUIREMENTS_2.md
    ├── REQUIREMENTS.md (extends)
    └── RUNBOOK.md (extends)

ADD_REQUIREMENTS_3.md
    ├── ADD_REQUIREMENTS_3_BREAKDOWN.md (decomposes)
    ├── ADD_REQUIREMENTS_3_SPECIFICATION.md (specifies)
    ├── ADD_REQUIREMENTS_3_IMPLEMENTATION_INSTRUCTIONS.md (implements)
    ├── ADD_REQUIREMENTS_3_AGENT_INSTRUCTIONS.md (instructs)
    ├── ADD_REQUIREMENTS_3_REMEDIATION_PLAN.md (remediates)
    ├── docs/api-contract.md (aligns)
    ├── docs/schemas/ (extends)
    └── docs/audit-events.md (extends)

INSTRUCTION_PRECISION_REQUIREMENTS.md
    └── INSTRUCTION_PRECISION_SPECIFICATION.md (specifies)

INSTRUCTION_PRECISION_SPECIFICATION.md
    ├── INSTRUCTION_PRECISION_DESIGN.md (designed_by)
    ├── docs/api-contract.md (aligns)
    └── docs/schemas/ (aligns)
```

### OpenCode Runtime Chain
```
OPENCODE_SPECIFICATION.md
    ├── WORKER_RUNTIME_SESSION_REQUIREMENTS.md (defines_runtime_contract)
    ├── OPENCODE_MIT_PORTING_NOTES.md (maps_opencode_concepts)
    ├── docs/releases/2026-06-23-opencode-compatible-runtime.md (summarizes_release)
    └── docs/evidence/shipyard-opencode-mit-runtime-20260623/qeg/README.md (evidences_gate)
```

### Reference Chain
```
docs/api-contract.md
    ├── docs/schemas/ (references)
    └── docs/openapi.yaml (defines)

docs/execution-reliability.md
    ├── docs/lock-and-lease.md (references)
    └── docs/audit-events.md (references)
```

## Updating Birdeye

### When to Update
- Adding new documentation files
- Changing document relationships
- Major requirement changes
- Project structure modifications

### Update Procedure
1. Edit `docs/birdseye/index.json` to update nodes/edges
2. Update corresponding capsule files in `docs/birdseye/caps/`
3. Update `docs/birdseye/hot.json` if primary nodes change
4. Regenerate this document if structure changes significantly

### Validation Commands
```bash
# Validate JSON files
node -e "JSON.parse(require('fs').readFileSync('docs/birdseye/index.json'))"
node -e "JSON.parse(require('fs').readFileSync('docs/birdseye/hot.json'))"
```

## Birdeye System Overview

Birdeye consists of three layers:

1. **index.json** - Foundation layer with node listings and edges
2. **caps/** - Capsule summaries for each document
3. **hot.json** - Hot list for immediate reference

For LLM consumption, start with `hot.json`, then navigate via `index.json` edges, and load detailed context from capsule files.

