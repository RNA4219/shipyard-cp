---
name: limits
description: View current operational limits from configuration
user_invocable: true
---

# Operational Limits

Display all operational limits configured for shipyard-cp.

## Limits Displayed

### API Rate Limits
| Tier | Requests/Min | Total |
|------|-------------|-------|
| public | 3 | 30 |
| standard | 10 | 100 |
| trans | 150 | 300 |

### Retry Limits
| Stage | Max Retries | Default Action |
|-------|-------------|----------------|
| plan | 2 | blocked |
| dev | 3 | retry_transient_only |
| acceptance | 1 | rework_required |
| integrate | 2 | blocked |
| publish | 1 | blocked |

### Backoff Settings
- Base: 1s
- Max: 60s
- Jitter: enabled
- Multiplier: 2x

### Lease & Heartbeat
- Duration: 300s (5 min)
- Heartbeat interval: 60s
- Grace multiplier: 3

### Concurrency
- Lock duration: 300s
- Optimistic lock: enabled
- Resource locks: task, repo_branch, environment, publish_target

### Agent Spawn Control
- Max concurrent: 300
- Spawn rate: 150/60s
- Burst: 150
- Overflow: queue

## Usage

Read `config.json` to display current limits. Use `/config` to modify settings.