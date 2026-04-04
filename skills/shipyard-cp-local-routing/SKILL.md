---
name: shipyard-cp-local-routing
description: Use when operating shipyard-cp and deciding how to mix local Qwen 4B or 27B runtimes with external providers. Apply it when the goal is to save tokens, move prep work to local models, reserve premium providers for high-risk stages, or define model roles across plan, dev, acceptance, integrate, and publish.
---

# shipyard-cp Local Routing

Use this skill to decide where local models fit into a shipyard-cp workflow.

## Entry Points

1. `README.md`
2. `docs/cli-usage.md`
3. `references/local-routing-table.md`
4. `../shipyard-cp-cli-quickstart/SKILL.md` when you need the main CLI flow
5. `../shipyard-cp-cli-pipeline/SKILL.md` when you need the full stage flow

## Default Rules

- Use local `Qwen3.5-4B` for routing, summarization, classification, compression, and checklist extraction.
- Use local `Qwen3.5-27B` for rewrites, draft generation, and first-pass review where local quality is good enough.
- Use external frontier providers for high-risk code changes, final acceptance judgment, and integrate or publish gates.
- Keep final gate evidence in shipyard-cp task, run, and audit logs even when local models are used in earlier stages.

## Operating Pattern

- Split each task into cheap prep work versus quality-critical output.
- Push cheap prep work to local models first.
- Send only the reduced, relevant context to premium providers.
- Prefer local `4B` before local `27B` when the work is mostly structured or classification-like.
- Prefer local `27B` before an external provider when a local draft can reduce expensive tokens later.

## Local Runtime

For runtime control, use the shared launcher skill and commands:

- the globally installed `local-llm-launcher` skill
- `/local-llm:start`
- `/local-llm:status`
- `/local-llm:verify`
- `/local-llm:stop`
