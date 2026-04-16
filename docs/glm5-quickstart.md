# GLM5 Quickstart

`shipyard-cp` を GLM5 主線で動かすときの最短手順です。  
DashScope / Alibaba Cloud の OpenAI-compatible endpoint を前提にしています。

## 方針

- `CLAUDE_WORKER_BACKEND=glm` を使って logical Claude worker を GLM5 adapter に流す
- model は `Alibaba_CodingPlan_MODEL=glm-5` を使う
- endpoint は `Alibaba_CodingPlan_API_ENDPOINT=https://coding-intl.dashscope.aliyuncs.com/v1` を使う
- 認証は `Alibaba_CodingPlan_KEY` または `GLM_API_KEY` または `DASHSCOPE_API_KEY` のどれかで供給する

## 最低限必要な設定

`.env` または環境変数で次を入れます。

```env
CLAUDE_WORKER_BACKEND=glm
CLAUDE_MODEL=glm-5
Alibaba_CodingPlan_MODEL=glm-5
Alibaba_CodingPlan_API_ENDPOINT=https://coding-intl.dashscope.aliyuncs.com/v1
Alibaba_CodingPlan_KEY=YOUR_SECRET_KEY
```

補足:

- `CLAUDE_MODEL` は run metadata 側の既定名
- 実際に GLM adapter が使う model 名は `Alibaba_CodingPlan_MODEL`
- key は `Alibaba_CodingPlan_KEY` が最優先で、未設定なら `GLM_API_KEY`、さらに未設定なら `DASHSCOPE_API_KEY` を参照する

## 起動

```bash
pnpm run dev
```

## 最初の確認

```bash
curl http://localhost:3100/healthz
curl http://localhost:3100/health/ready
```

期待:

- backend が起動する
- health endpoint が返る
- task dispatch 時に Claude logical worker が `glm` backend を使う

## 詰まりやすい点

- `CLAUDE_WORKER_BACKEND` を入れ忘れると `opencode` に戻る
- `Alibaba_CodingPlan_MODEL` を変えても `CLAUDE_MODEL` が古いままだとログ上の表示名がずれる
- key は repo に直書きせず、`.env` か shell 環境変数で管理する
- 本番や共有環境では `AUTH_ENABLED` と API key 群も合わせて入れる

## 推奨

- local GGUF は補助用途に回し、主線は `GLM5`
- 高リスクな acceptance / integrate / publish は task と audit を必ず確認する
