# shipyard-cp

LiteLLM を推論ゲートウェイ、Codex / Claude Code / Google Antigravity をワーカーとして扱う AI orchestration control plane の設計・実装用リポジトリ。

## 現在の内容

- [REQUIREMENTS.md](./REQUIREMENTS.md): 要件定義
- [RUNBOOK.md](./RUNBOOK.md): 実装着手手順
- [docs/state-machine.md](./docs/state-machine.md): 状態遷移仕様
- [docs/api-contract.md](./docs/api-contract.md): API 契約ドラフト
- [docs/execution-reliability.md](./docs/execution-reliability.md): retry / lease / lock / capability gate の補助仕様
- [docs/lock-and-lease.md](./docs/lock-and-lease.md): lock / lease / heartbeat / orphan recovery の詳細
- [docs/audit-events.md](./docs/audit-events.md): 監査イベント種別の補助仕様
- [docs/openapi.yaml](./docs/openapi.yaml): OpenAPI 3.1 雛形
- [docs/implementation-prep.md](./docs/implementation-prep.md): 実装準備メモ
- [docs/schemas/README.md](./docs/schemas/README.md): JSON Schema 一覧
- `src/`: Fastify ベースの最小 API 骨格

## セットアップ

```bash
npm install
npm run dev
```

`GET /healthz` で疎通確認できる。`GET /openapi.yaml` で現在の OpenAPI を返し、`GET /schemas/{name}` で schema を返す。

## 依存 OSS

- `agent-taskstate`: internal task state / typed_ref / context bundle の正本
- `memx-resolver`: docs resolve / chunks / ack / stale / contract resolve
- `tracker-bridge-materials`: tracker issue / project item / sync event / entity link

## 現時点の実装方針

- 永続化は未実装で、Task / Job / Result / Event はインメモリ管理。
- `Integrate` と `Publish` は実ジョブ実行ではなく、状態遷移の骨格のみ実装。
- まず API 契約と状態遷移の整合を確立し、その後に DB、worker adapter、GitHub 連携を追加する想定。
