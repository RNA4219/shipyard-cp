---
intent_id: SHIPYARD-ACCEPTANCE-REMEDIATION
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# 検収 No-Go 解消 実装指示書

## 目的

本書は [ACCEPTANCE_REMEDIATION_REQUIREMENTS.md](./ACCEPTANCE_REMEDIATION_REQUIREMENTS.md) と [ACCEPTANCE_REMEDIATION_SPECIFICATION.md](./ACCEPTANCE_REMEDIATION_SPECIFICATION.md) を、別エージェントが実装へ移せる Task Seed 相当の作業単位へ分解する。

## 実装原則

1. 1 PR につき 1 つの No-Go 要因を解消する。
2. docs-only 修正と runtime 修正を混ぜすぎない。
3. 既存 API / state machine / WorkerJob / WorkerResult 契約を破壊しない。
4. false positive suppression は path 単位、期限付き、理由付きにする。
5. Go 判定を急ぐ場合は P0 を先に終わらせ、保守性 refactor は後続へ回す。

## 推奨ブランチ

```powershell
git checkout -b codex/acceptance-remediation
```

## Task Seed 0: 事前確認

### Objective

作業前の現状を固定し、検収時の No-Go 要因を再現できるようにする。

### Scope

In:

- docs / lint / test / code-to-gate readiness の現状確認

Out:

- 実装変更

### Commands

```powershell
cd ..\shipyard-cp
npm run lint
npm test
npm run build

cd web
npm run lint
npm test
npm run build
```

### Acceptance

- 既知の web lint 2 件を再現できる。
- backend lint/test/build が成功する。

## Task Seed 1: CLI typed_ref examples remediation

### Objective

CLI-first 導線の task 作成成功例を API 契約と一致させる。

### Affected Paths

- `.claude/commands/run.md`
- `.claude/commands/pipeline.md`
- `.claude/commands/batch.md`

### Requirements

- 成功例の `typed_ref` は 4 セグメント canonical form にする。
- batch 例では task ごとに entity id を分ける。
- API 契約の説明と矛盾する例を残さない。

### Suggested Patch

- `task_001` -> `agent-taskstate:task:local:task-001`
- `pipeline_001` -> `agent-taskstate:task:local:pipeline-001`
- `batch_001` -> `agent-taskstate:task:local:batch-001`
- `batch_002` -> `agent-taskstate:task:local:batch-002`

### Commands

```powershell
rg -n '"typed_ref"' .claude docs README.md
npm test -- static-docs.test.ts
```

### Acceptance

- `.claude/commands` の成功例に単一セグメント `typed_ref` が残らない。
- docs の validation 説明と例が一致する。

## Task Seed 2: Web lint remediation

### Objective

Web 補助 UI の lint gate を復旧する。

### Affected Paths

- `web/e2e/api-test.spec.ts`
- `web/src/contexts/LanguageContext.tsx`
- 必要なら `web/src/contexts/language-data.ts` などの新規 helper file

### Requirements

- 未使用変数をなくす。
- Fast Refresh rule に従い、component export と非 component export を分離する。
- 既存の import API を壊さない。

### Commands

```powershell
cd web
npm run lint
npm test
npm run build
```

### Acceptance

- lint / test / build がすべて成功する。

## Task Seed 3: Agent route rate limit validation

### Objective

`/v1/agent/register` と `/v1/agent/unregister` の abuse 防御を確認し、必要なら実装する。

### Affected Paths

- `src/routes/agent-routes.ts`
- `src/app.ts`
- `src/auth/auth-plugin.ts`
- `test/agent-routes.test.ts` または既存 route test

### Requirements

- auth enabled 時の未認証 request は拒否する。
- rate limit が当該 route に適用されていることをテストする。
- global rate limit で十分なら route 個別実装は不要。ただしテストまたは docs で根拠を残す。

### Commands

```powershell
cd ..\shipyard-cp
npm test -- agent-routes
npm test
```

### Acceptance

- `code-to-gate` の `MISSING_RATE_LIMIT` 指摘に対する実装または根拠付き waiver がある。
- agent route の正常系が壊れていない。

## Task Seed 4: code-to-gate false positive suppression

### Objective

`MISSING_INPUT_SANITIZATION` critical 3 件を実リスクと false positive に分類し、readiness を release 判定に使える状態へ戻す。

### Affected Paths

- `.ctg/suppressions.yaml`
- `src/infrastructure/opencode-session-executor.ts`
- `src/infrastructure/session-executor/execute.ts`
- `src/store/control-plane-store.ts`

### Requirements

- false positive なら path 単位で suppression を追加する。
- 実リスクなら defensive hardening とテストを追加する。
- broad suppression を追加しない。

### Commands

```powershell
cd ..\..\code-to-gate

node .\dist\cli.js analyze ..\shipyard-cp\src --emit all --out .\.shipyard-ctg\src --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\src --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\src --out .\.shipyard-ctg\src
```

### Acceptance

- `src` readiness が `blocked_input` ではない。
- suppression の reason と expiry が明示されている。

## Task Seed 5: Scoped code-to-gate acceptance command documentation

### Objective

`shipyard-cp` 検収時に `code-to-gate` を再実行できる手順を RUNBOOK へ追加する。

### Affected Paths

- `docs/project/RUNBOOK.md`
- 必要なら `docs/project/ACCEPTANCE_REMEDIATION_SPECIFICATION.md`

### Requirements

- `src` / `packages` / `web/src` の scoped analyze / readiness を文書化する。
- root full scan timeout は既知制約として記録する。
- 出力先を `code-to-gate/.shipyard-ctg/*` に固定する。

### Commands

```powershell
rg -n "code-to-gate|shipyard-ctg|readiness" docs/project/RUNBOOK.md docs/project/ACCEPTANCE_REMEDIATION_SPECIFICATION.md
```

### Acceptance

- 別エージェントが手順を見て同じ scoped readiness を再実行できる。

## Task Seed 6: Runtime smoke record

### Objective

mock ではない worker runtime の最小 smoke 証跡を作る。

### Affected Paths

- `docs/project/RUNBOOK.md`
- 必要なら `docs/verification-log.md`
- 必要なら smoke script / test

### Requirements

- OpenCode、GLM、local OpenAI-compatible runtime のいずれか 1 経路を選ぶ。
- key / binary 不足時の skip 条件を明記する。
- task id / job id / final state / runtime / result を記録する。

### Commands

実装者は選択した runtime に応じて、RUNBOOK の既存手順を使うこと。

最小確認:

```powershell
curl http://localhost:3100/healthz
```

### Acceptance

- live smoke または明示 skip の証跡が残る。
- release 前 Go 判定では少なくとも 1 live path が通っている。

## Final Gate

全 Task Seed 完了後、次を実行する。

```powershell
cd ..\shipyard-cp

npm run lint
npm test
npm run build

cd web
npm run lint
npm test
npm run build
```

```powershell
cd ..\..\code-to-gate

node .\dist\cli.js analyze ..\shipyard-cp\src --emit all --out .\.shipyard-ctg\src --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\src --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\src --out .\.shipyard-ctg\src

node .\dist\cli.js analyze ..\shipyard-cp\packages --emit all --out .\.shipyard-ctg\packages --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\packages --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\packages --out .\.shipyard-ctg\packages

node .\dist\cli.js analyze ..\shipyard-cp\web\src --emit all --out .\.shipyard-ctg\web-src --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\web\src --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\web-src --out .\.shipyard-ctg\web-src
```

## Completion Criteria

- P0 Task Seed 1-2 が完了している。
- P1 Task Seed 3-5 が完了している。
- `src` readiness が `blocked_input` ではない。
- web lint が成功している。
- Go / Conditional Go / No-Go 判定を更新できるだけの evidence が揃っている。

