---
intent_id: INT-RUN-SYSTEM-EXTERNAL-CLI-001
owner: shipyard-cp
status: implemented
version: 0.4.0
last_reviewed_at: 2026-06-22
---

# Run System 外部4OSS CLI adapter 要件

## 目的

`RunSystemGate` の内部判定に加えて、外部4OSSのCLIを実際に呼び出し、判定・検証・証跡を Shipyard Run に戻す。

対象OSS:

- `agent-protocols`
- `agent-taskstate`
- `agent-gatefield`
- `agent-state-gate`

## 機能要件

### EXT-CLI-REQ-001 agent-protocols 実呼び出し

Shipyard は `agent-protocols` の契約検証CLIを呼び出せなければならない。

既定コマンド:

```powershell
npm run validate -- --run --reporter=dot
```

`exit 0` を pass とし、非0終了は blocker とする。

### EXT-CLI-REQ-002 agent-taskstate 実呼び出し

Shipyard は `agent-taskstate` のCLI存在と基本契約を確認できなければならない。

既定コマンド:

```powershell
uv run --offline --no-sync python -m src.cli --help
```

`exit 0` を pass とし、repo未検出または起動不能は residual risk として扱う。

### EXT-CLI-REQ-003 agent-gatefield 実呼び出し

Shipyard は `agent-gatefield` のDecisionPacket CLIを呼び出し、JSON decision を解釈できなければならない。

既定コマンド:

```powershell
uv run --offline --no-sync python -m cli.gate_cli dry-run --run-id <job_id> --json
```

`agent-gatefield` は `hold` / `block` で非0終了する場合があるため、exit code だけでCLI故障と見なしてはならない。

- `decision=pass|warn`: pass
- `decision=hold`: residual risk / manual review
- `decision=block`: blocker

### EXT-CLI-REQ-004 agent-state-gate 実呼び出し

Shipyard は `agent-state-gate` の統合gate CLIを呼び出し、JSON verdict を解釈できなければならない。

既定コマンド:

```powershell
uv run --offline --no-sync agent-state-gate gate evaluate --task <task_id> --run <job_id> --output json
```

`verdict=allow` だけを pass とし、それ以外は `RunSystemGate` に合成する。

### EXT-CLI-REQ-005 auditとartifact

外部CLI実行結果は、標準化された `ExternalRunSystemCliReport` として保存しなければならない。

保存先:

```text
artifacts/run-system-cli/<job_id>/external-cli-report.json
```

各コマンドについて以下を保持する。

- system
- command
- cwd
- exit_code
- status
- stdout
- stderr
- parsed_json
- summary

### EXT-CLI-REQ-006 advisory / enforce 合成

外部CLI結果は `RunSystemGateReport` に合成される。

- advisory mode: `run.externalCliGateEvaluated` を出すが状態遷移は止めない。
- enforce mode: external blocker、`agent-state-gate` `allow` 以外、`agent-gatefield block` で状態遷移を止める。
- `agent-gatefield hold` は residual risk とし、enforceでは human/manual gate に回せる。

### EXT-CLI-REQ-007 failure policy

外部repoが存在しない、CLIが起動できない、JSONが読めない場合は次の扱いにする。

- advisory: residual risk として記録し、Run遷移は止めない。
- enforce: state-gateが `allow` を返せない限り停止候補にする。
- CLI実行はtimeout付き同期実行とし、無制限に待機しない。

## 受入条件

- `LocalRunSystemCliAdapter` が4OSSコマンドを実行できる。
- `agent-gatefield` の `hold` exit 1 をJSON decisionとして扱える。
- `agent-state-gate deny` を enforce mode で `blocked` にできる。
- 外部CLI結果が `run.externalCliGateEvaluated` audit event と artifact に残る。
- QEG/manual-bb evidence package が外部CLI adapter 実装を検証する。

## 範囲外

- 外部4OSSの正本DBへmutationすること。
- HTTP API / MCP surface 経由の本番接続。
- production blocking mode の既定有効化。
