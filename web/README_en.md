# shipyard-cp Web UI

[日本語版](./README.md) | English

`web/` is the auxiliary UI for shipyard-cp.  
The core of this repository is backend/worker/CLI, and frontend handles task/run visualization and auxiliary operations.

## Position

- Primary path: backend/worker/CLI
- Auxiliary path: Web UI
- Master contract: root-side API/OpenAPI/schema

Web UI is not a standalone product; consider it a companion UI for control plane status checking and light operations.

## Capabilities

- Task list/details
- Run list/details
- Timeline/audit summary viewing
- Auxiliary dispatch/acceptance completion/settings operations
- WebSocket connection status check

## Usage

```bash
npm install
npm run dev
```

Normally started together with root backend.  
For the full entry point, see [../docs/cli-usage.md](../docs/cli-usage.md).

## Development Notes

- React + TypeScript + Vite
- Tailwind CSS
- React Router
- TanStack Query

## Related Documentation

- [CLI Usage](../docs/cli-usage.md)
- [Frontend Runbook](./FRONTEND_RUNBOOK.md)
- [Frontend Spec](./FRONTEND_SPEC.md)