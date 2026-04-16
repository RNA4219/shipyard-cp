# GLM5 運用指示書

このファイルは、`shipyard-cp` を `GLM5` 主線で運用するときの実務用メモです。  
実行担当者が迷わず同じ手順を踏めるように、設定、起動、確認、切り分けを順番にまとめています。

## 目的

- `shipyard-cp` の logical Claude worker を `GLM5` backend へ流す
- local GGUF には依存せず、DashScope / Alibaba Cloud endpoint を主線にする
- health 確認、task 作成、dispatch、一次切り分けまでを標準化する

## 前提

- 対象 repo: `C:\Users\ryo-n\Codex_dev\shipyard-cp`
- backend 起動は `pnpm run dev`
- 設定値は `.env` または shell 環境変数から読む
- 本 repo では `CLAUDE_WORKER_BACKEND=glm` で GLM adapter を使う

## 必須設定

`.env` に最低限、次を入れる。

```env
CLAUDE_WORKER_BACKEND=glm
CLAUDE_MODEL=glm-5
Alibaba_CodingPlan_MODEL=glm-5
Alibaba_CodingPlan_API_ENDPOINT=https://coding-intl.dashscope.aliyuncs.com/v1
Alibaba_CodingPlan_KEY=YOUR_SECRET_KEY
```

補足:

- `Alibaba_CodingPlan_KEY` が最優先
- 未設定なら `GLM_API_KEY`
- さらに未設定なら `DASHSCOPE_API_KEY`
- `CLAUDE_MODEL` は run metadata の既定表示名
- 実際に adapter が使う model 名は `Alibaba_CodingPlan_MODEL`

## 認証

ローカル単体検証では auth を切ってもよいが、共有環境や本番では必ず認証を入れる。

```env
AUTH_ENABLED=true
API_KEY=YOUR_OPERATOR_KEY
ADMIN_API_KEY=YOUR_ADMIN_KEY
```

## 起動手順

repo 直下で実行する。

```bash
pnpm install
pnpm run dev
```

## 最初の確認

### health

```bash
curl http://localhost:3100/healthz
curl http://localhost:3100/health/ready
```

期待:

- backend が起動している
- `healthz` が 200 を返す
- `health/ready` が 200 または依存状態に応じた応答を返す

### 設定確認

起動ログまたは設定読込で、少なくとも次が一致していることを確認する。

- `claudeBackend = glm`
- `claudeModel = glm-5`
- `glmModel = glm-5`
- `glmEndpoint = https://coding-intl.dashscope.aliyuncs.com/v1`

## Task 作成

```bash
curl -X POST http://localhost:3100/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "GLM5 routing smoke test",
    "objective": "Verify shipyard-cp dispatches through GLM5 backend",
    "typed_ref": "agent-taskstate:task:github:glm5-smoke-001",
    "repo_ref": {
      "provider": "github",
      "owner": "local",
      "name": "shipyard-cp",
      "default_branch": "main"
    }
  }'
```

auth を有効にしている場合は `X-API-Key` を付ける。

## Dispatch

```bash
curl -X POST http://localhost:3100/v1/tasks/TASK_ID/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "target_stage": "plan",
    "worker_selection": "claude_code"
  }'
```

期待:

- task が `planning` へ進む
- logical Claude worker が `glm` backend を使う
- audit / events に dispatch の記録が残る

## 状態確認

```bash
curl http://localhost:3100/v1/tasks
curl http://localhost:3100/v1/tasks/TASK_ID
curl http://localhost:3100/v1/tasks/TASK_ID/events
```

見るポイント:

- task state が `queued -> planning -> planned` の順に進むか
- `failed` や `blocked` になっていないか
- event に backend 切替や dispatch の痕跡があるか

## よくある詰まりどころ

### `opencode` 側へ流れてしまう

確認:

- `.env` に `CLAUDE_WORKER_BACKEND=glm` が入っているか
- 起動プロセスが `.env` を読んでいるか
- 古いサーバープロセスを見ていないか

### `GLM5` 認証で失敗する

確認:

- `Alibaba_CodingPlan_KEY` が正しいか
- endpoint が `https://coding-intl.dashscope.aliyuncs.com/v1` になっているか
- key の優先順で別の環境変数が上書きしていないか

### model 名がずれる

確認:

- `CLAUDE_MODEL=glm-5`
- `Alibaba_CodingPlan_MODEL=glm-5`

片方だけ変えると、ログや metadata の表示名と実際の呼び先がずれて見えることがある。

### local GGUF と混線する

方針:

- 主線は `GLM5`
- local GGUF は補助用途だけ
- 切り分け中は `CLAUDE_WORKER_BACKEND=glm` を固定し、local runtime を混ぜない

## 標準方針

- 主線: `GLM5`
- local GGUF: 補助用途
- acceptance / integrate / publish は audit と task events を必ず確認
- shared / production では auth を必ず有効化

## 関連ドキュメント

- `docs/glm5-quickstart.md`
- `docs/cli-usage.md`
- `README.md`
