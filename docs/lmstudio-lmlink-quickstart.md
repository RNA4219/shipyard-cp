# LM Studio / LM Link Quickstart

shipyard-cp は LM Studio の OpenAI 互換 API (`/v1/models`, `/v1/chat/completions`) のみを利用します。LM Link はこの API surface を保ったままモデル実行を remote device へ透過的に送るため、shipyard-cp 側の設定は変わりません。

## 1. ローカル API

1. LM Studio でモデルを利用可能にし、OpenAI 互換 server を起動します。
2. `http://localhost:1234/v1/models` が応答することを確認します。
3. `.env` にモデルIDと routing policy を設定します。

```dotenv
LMSTUDIO_ENABLED=true
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_TOKEN=optional-local-token
LMSTUDIO_MODEL=your-model-id
LMSTUDIO_ROUTE_WORKERS=codex,claude_code
LMSTUDIO_ALLOWED_STAGES=plan,dev
LMSTUDIO_MAX_RISK=low
LMSTUDIO_FALLBACK_STAGES=plan
LMSTUDIO_TIMEOUT_MS=300000
LMSTUDIO_MAX_CONCURRENCY=1
```

## 構造化出力

LM Studio profileは`/v1/chat/completions`へ、stageごとの`response_format.type=json_schema`を渡します。LM Studioのgrammar制約でplan/devのJSON形式を保証し、Shipyardは返却文字列を既存のplan/tool plan validatorと安全な`ToolPlanExecutor`へ渡します。これはモデルにshellや任意ファイル権限を渡すものではありません。

実機確認の最小手順は次のとおりです。モデルIDは`/v1/models`が返す値を使います。

```powershell
lms server start --port 1234 --bind 127.0.0.1
lms load <model-id> --context-length 4096 --parallel 1 --ttl 1800 --yes
```

JSON schemaに対応しないモデルやserverでは、Shipyardは非JSON出力を`structured_output_parse_error`として安全に拒否し、raw output artifactを保護規則に従って保存します。

## 2. コンテナから接続する場合

production compose に LM Studio は含めません。Docker Desktop からホストのAPIを参照する場合は次を使います。

```dotenv
LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
LMSTUDIO_API_TOKEN=required-when-production
```

production では base URL、token、モデルIDが不足すると起動を拒否します。LM Studioをlocalhost以外へbindする場合も、LM Studio側でtoken認証を有効にしてください。

## 3. LM Link

LM Linkでremote device上だけにあるモデルをpreferred deviceとして選んでも、shipyard-cp は引き続き `LMSTUDIO_BASE_URL` のローカルLM Studioへ接続します。remote deviceの識別子、モデルdownload/load/unload、preferred deviceの変更を shipyard-cp は保存・操作しません。

## Routing policy

- `codex` と `claude_code` の low-risk `plan` / `dev` は LM Studio を優先します。
- LM Studioが利用不能な場合、`plan` のみ外部backendへフォールバックできます。
- `dev` と最終Acceptanceは、明示的に構成しない限り外部backendへ自動再送しません。
- Job metadata、Result、auditには選択backendとフォールバック理由を記録します。

## Troubleshooting

- `401`: `LMSTUDIO_API_TOKEN` と LM Studio server の認証設定を一致させます。
- `404` / model not found: `LMSTUDIO_MODEL`（またはworker別model）を`/v1/models`のIDと完全一致させます。モデルをload/unloadするのはLM Studio側です。
- timeout / `5xx`: shipyard-cpは`OPENAI_COMPATIBLE_TIMEOUT` / `OPENAI_COMPATIBLE_UPSTREAM_5XX`として記録します。`plan`だけは外部backend fallbackを許可できますが、`dev` / Acceptanceはblockして明示判断します。
- invalid JSON / empty choices: 構造化tool planとして拒否し、raw output artifactを保護規則に従って保存します。prompt・Authorization header・tokenは通常ログへ出しません。
- LM Link: 接続確認は常に`LMSTUDIO_BASE_URL`へ行います。remote device情報をshipyardのTask payloadやmetadataへ追加しないでください。
- 実証時は、redact済みLM Studioログ、Job/Result/audit、使用model IDをAcceptance Recordへ残します。
