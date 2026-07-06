# QEG fixture: shipyard-external-cli-adapter-20260622

対象: External 4OSS CLI adapter

検証:

```powershell
cd ..\..\quality-evidence-graph
npm run validate -- ..\Agent_tools\shipyard-cp\docs\evidence\shipyard-external-cli-adapter-20260622\qeg
```

期待:

- verdict: `go`
- blockers: `[]`
- residual risks: `[]`
- exit code: `0`
