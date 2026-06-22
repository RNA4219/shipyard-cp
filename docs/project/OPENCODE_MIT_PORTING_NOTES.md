# OpenCode MIT Porting Notes

Version: `0.1.0`

## 目的

Shipyard は `opencode` を worker substrate として扱うだけでなく、MIT License のもとで公開されている session / tool / event 設計を control plane 側にも取り込む。

本書は、どの概念を Shipyard に移植したか、どこを意図的に移植しないか、ライセンス上どの notice を保持すべきかを追跡する。

## Source

- Local source: `C:/Users/ryo-n/Codex_dev/opencode`
- License: MIT License
- License file: `C:/Users/ryo-n/Codex_dev/opencode/LICENSE`
- Referenced specs:
  - `specs/v2/session.md`
  - `specs/v2/tools.md`
  - `specs/v2/provider-policy.md`

## MIT Notice

The upstream `opencode` repository contains the following license notice:

```text
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

Substantial direct code ports from `opencode` must preserve this notice in the relevant distribution material.

## Adopted Concepts

| Shipyard area | OpenCode source concept | Shipyard adaptation |
| --- | --- | --- |
| `WorkerRuntimeSession` | Durable prompt admission and safe promotion boundary | `admitInput()` stores prompt input separately from visible turns; `promoteAdmittedInputs()` promotes later. |
| `WorkerRuntimeSession` | Durable event cursor and replay | runtime events now have `event_id` and monotonic `sequence`; `collectEvents(afterSequence)` supports replay. |
| `RuntimeToolRegistry` | Scoped tool registration and stale-call rejection | registrations receive `registration_id`; same-name overlays reveal previous registrations on close; stale `registration_id` is rejected. |
| `ToolResultNormalizer` | Model-facing output bounding separate from retained output | `bounded=true` and `retained_artifact_id` preserve the distinction between preview and full artifact. |
| `OpenCodeRuntimeEventBridge` | Durable event replay cursor | bridge returns `source_event_count` and deterministic `replay_cursor`. |

## Explicit Non-Ports

The following OpenCode areas are intentionally not ported in this slice:

- TUI / live approval UX
- provider and model registry
- slash command and prompt template runtime
- Effect/Bun service runtime
- plugin hook lifecycle
- full post-crash provider dispatch recovery

These can be reconsidered only when Shipyard has a concrete control-plane need and an acceptance gate.

