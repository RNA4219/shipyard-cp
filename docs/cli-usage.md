# shipyard-cp CLI Usage

shipyard-cp の日常運用は CLI-first を前提とする。人が触る主入口は API 直打ちではなく、Claude Code / Codex から使う `.claude/commands/` と、この文書である。

## 位置づけ

- 主導線: CLI / Claude Code コマンド
- 補助導線: Web UI
- 内部契約: API / OpenAPI / schema

`.claude/commands/` は product runtime の一部ではなく、運用補助コマンド集として扱う。

## 最初に読む順番

1. [README.md](../README.md)
2. [run.md](../.claude/commands/run.md)
3. [status.md](../.claude/commands/status.md)
4. 必要なら [pipeline.md](../.claude/commands/pipeline.md)
5. GLM5 を主線にするときは [glm5-quickstart.md](./glm5-quickstart.md)
6. 実装や現在値を深掘りするときは [RUNBOOK.md](./project/RUNBOOK.md)

## 最短手順

```bash
pnpm install
pnpm run dev
```

その後、Claude Code / Codex から次を入口に使う。

- 単発 task: [run.md](../.claude/commands/run.md)
- 状態確認: [status.md](../.claude/commands/status.md)
- フルフロー: [pipeline.md](../.claude/commands/pipeline.md)

## コマンドの役割

### `/run`

- task を 1 件作成して dispatch する
- plan / dev / acceptance の単発実行に向く

### `/status`

- task / events / runs の現在値を確認する
- 問題が出たときの最初の確認入口

### `/pipeline`

- plan -> dev -> acceptance -> integrate -> publish を順に追う
- リリース前の通し確認に向く

## 失敗時の確認順

1. `status` で task state を見る
2. task events を見る
3. run timeline / audit summary を見る
4. 必要なら Web UI で補助確認する
5. それでも足りなければ API / OpenAPI を参照する

## 人手確認が入る場所

- acceptance 完了
- publish 承認
- 高リスク task の手動検証ログ確認

CLI-first でも、これらの gate は飛ばさず明示的に扱う。

## 最小環境変数

ローカル起動の最低限:

- `.env` または環境変数
- Redis を使う場合は `REDIS_URL`

worker / 外部連携で必要:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GITHUB_TOKEN`
- `AUTH_ENABLED`, `API_KEY`, `ADMIN_API_KEY` を本番または共有環境で必ず設定

GLM / local OpenAI-compatible runtime を使う場合:

- `CLAUDE_WORKER_BACKEND=glm`
- `Alibaba_CodingPlan_API_ENDPOINT` を DashScope または local `llama-server` の `/v1` へ向ける
- `Alibaba_CodingPlan_MODEL` に server が expose する model 名を入れる
- local GGUF を使うときは、先に `llama-server` 側で model を起動してから `shipyard-cp` を起動する

GLM5 を主線にする場合:

- `docs/glm5-quickstart.md` の設定をそのまま使う
- local GGUF は補助用途に回し、主 worker は `GLM5` に寄せる

ライブテストや publish 系では、必要なキーだけ個別に追加する。

## インフラ資材の場所

- compose: [infra/docker-compose.yml](../infra/docker-compose.yml)
- production compose: [infra/docker/docker-compose.yml](../infra/docker/docker-compose.yml)
- backend Dockerfile: [infra/docker/api.Dockerfile](../infra/docker/api.Dockerfile)
- k8s/TLS: [infra/kubernetes/tls](../infra/kubernetes/tls)

## Web UI の位置づけ

Web UI は補助UI。主導線は backend / worker / CLI に置く。

- task / run の閲覧
- 状態確認
- 補助的な操作

本命運用は CLI-first で考える。
