# shipyard-cp

LiteLLM を推論ゲートウェイ、Codex / Claude Code / Google Antigravity をワーカーとして扱う AI orchestration control plane の設計・実装用リポジトリ。

## 現在の内容

- [REQUIREMENTS.md](./REQUIREMENTS.md): 要件定義
- [docs/state-machine.md](./docs/state-machine.md): 状態遷移仕様
- [docs/api-contract.md](./docs/api-contract.md): API 契約ドラフト
- [docs/openapi.yaml](./docs/openapi.yaml): OpenAPI 3.1 雛形
- [docs/schemas/README.md](./docs/schemas/README.md): JSON Schema 一覧
- `src/`: Fastify ベースの最小 API 骨格

## セットアップ

```bash
npm install
npm run dev
```

`GET /healthz` で疎通確認できる。`GET /openapi.yaml` で現在の OpenAPI を返し、`GET /schemas/{name}` で schema を返す。

## 現時点の実装方針

- 永続化は未実装で、Task / Job / Result / Event はインメモリ管理。
- `Integrate` と `Publish` は実ジョブ実行ではなく、状態遷移の骨格のみ実装。
- まず API 契約と状態遷移の整合を確立し、その後に DB、worker adapter、GitHub 連携を追加する想定。
