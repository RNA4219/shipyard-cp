---
name: config
description: View or update shipyard-cp configuration settings
user_invocable: true
---

# Shipyard Configuration

View current configuration or update settings in `config.json`.

## Usage

When the user asks to:
- Check current configuration
- View rate limits, retry settings, lease duration, etc.
- Update configuration values
- Reset configuration to defaults

## Actions

1. **View config**: Read `config.json` (or `config.example.json` if not present) and display relevant section
2. **Update config**: Modify `config.json` with user-specified values
3. **Validate config**: Check against `config.schema.json`
4. **Reset config**: Copy `config.example.json` over `config.json`

## Configuration Sections

- `api_rate_limits`: Rate limiting tiers (public/standard/trans)
- `retry`: Retry limits and backoff per stage
- `doom_loop`: Loop detection settings
- `lease`: Lease duration and heartbeat config
- `concurrency`: Lock and concurrent execution settings
- `agent_spawn`: Sub-agent spawn limits
- `capability`: Stage capability requirements