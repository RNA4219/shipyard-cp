# shipyard-cp Birdeye

Birdeye is a knowledge map for navigating shipyard-cp documentation. Use this document for quick reference and document discovery.

## Project Status (2026-03-20)

| Priority | Status | Description |
|----------|--------|-------------|
| P0 | ✅ Complete | Production essentials: WorkerExecutor, ServiceHealthChecker, Auth, CI/CD |
| P1 | ✅ Complete | Feature completion: Failover, retry/failure_class integration, publish idempotency |
| P2 | ✅ Complete | Quality: Base SHA validation, branch prefix dynamic, log artifact validation |

## Hot List (Primary Entry Points)

| Priority | Document | Role | Description |
|----------|----------|------|-------------|
| 1 | [README.md](./README.md) | Overview | Project setup, implementation status, API summary |
| 2 | [RUNBOOK.md](./RUNBOOK.md) | Operations | Implementation procedures and progress tracking |
| 3 | [REQUIREMENTS.md](./REQUIREMENTS.md) | Requirements | Authoritative requirements definition |
| 4 | [docs/state-machine.md](./docs/state-machine.md) | Specification | 16 states, transitions, guard conditions |
| 5 | [docs/api-contract.md](./docs/api-contract.md) | Specification | API endpoints and validation rules |
| 6 | [docs/birdseye/index.json](./docs/birdseye/index.json) | Navigation | Full node listings and edges |

## Quick Navigation

### Getting Started
1. [README.md](./README.md) - Project overview
2. [RUNBOOK.md](./RUNBOOK.md) - Implementation procedures
3. [docs/implementation-prep.md](./docs/implementation-prep.md) - Pre-implementation checklist

### Implementation
1. [RUNBOOK.md](./RUNBOOK.md) - Step-by-step procedures
2. [docs/state-machine.md](./docs/state-machine.md) - State transitions
3. [docs/api-contract.md](./docs/api-contract.md) - API definitions
4. [docs/openapi.yaml](./docs/openapi.yaml) - OpenAPI schema

### Execution Reliability
1. [docs/execution-reliability.md](./docs/execution-reliability.md) - Retry, doom-loop, capability, concurrency
2. [docs/lock-and-lease.md](./docs/lock-and-lease.md) - Lock, lease, heartbeat, orphan recovery
3. [docs/audit-events.md](./docs/audit-events.md) - Audit event types

### Deployment
1. [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) - Production deployment
2. [RUNBOOK.md](./RUNBOOK.md) - Operational status

### Requirements
1. [REQUIREMENTS.md](./REQUIREMENTS.md) - Primary requirements
2. [ADD_REQUIREMENTS.md](./ADD_REQUIREMENTS.md) - Execution reliability supplements
3. [ADD_REQUIREMENTS_2.md](./ADD_REQUIREMENTS_2.md) - Visualization and retrospective

## Document Roles

| Role | Description | Documents |
|------|-------------|-----------|
| **overview** | Project entry point | README.md |
| **operations** | Implementation and deployment | RUNBOOK.md, docs/DEPLOYMENT.md |
| **requirements** | Requirements definitions | REQUIREMENTS.md, ADD_REQUIREMENTS.md, ADD_REQUIREMENTS_2.md |
| **specification** | Technical specifications | docs/state-machine.md, docs/api-contract.md, docs/execution-reliability.md, docs/lock-and-lease.md, docs/audit-events.md, docs/openapi.yaml, docs/schemas/ |
| **guide** | Implementation preparation | docs/implementation-prep.md |

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
    └── docs/api-contract.md (source_of_truth)
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