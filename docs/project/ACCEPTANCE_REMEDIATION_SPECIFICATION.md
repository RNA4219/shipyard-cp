---
intent_id: SHIPYARD-ACCEPTANCE-REMEDIATION
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# 検収 No-Go 解消 仕様書

## 文書の目的

本書は [ACCEPTANCE_REMEDIATION_REQUIREMENTS.md](./ACCEPTANCE_REMEDIATION_REQUIREMENTS.md) を、実装可能な仕様へ落とす。

目的は、`shipyard-cp` の中核設計を変更することではなく、検収時に No-Go となった導線、lint、security gate、解析再現性、runtime smoke の不足を小さく解消することである。

## 全体方針

1. CLI-first 導線を API 契約と一致させる。
2. Web 補助 UI の lint を CI gate として信頼できる状態に戻す。
3. `code-to-gate` の critical / high を実リスクと false positive に分類する。
4. 実リスクはテスト付きで修正し、false positive は期限付き suppression として追跡する。
5. runtime smoke は live path と skip path を分け、環境差で gate が曖昧にならないようにする。

## 仕様 S1: CLI command examples

### 対象ファイル

- `.claude/commands/run.md`
- `.claude/commands/pipeline.md`
- `.claude/commands/batch.md`

### 変更仕様

成功例の `typed_ref` は次の正規表現に一致しなければならない。

```text
^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$
```

推奨例:

```json
{
  "typed_ref": "agent-taskstate:task:local:task-001"
}
```

batch 例では task ごとに entity id を分ける。

```json
{
  "typed_ref": "agent-taskstate:task:local:batch-001"
}
```

### 禁止事項

- 成功例で `task_001`、`pipeline_001`、`batch_001` のような単一セグメント ID を使わない。
- `typed_ref` validation の説明なしに不正形式を例示しない。

### 検証

```powershell
rg -n '"typed_ref":\s*"(task_|pipeline_|batch_|[^":]+")' .claude docs README.md
```

上記は、不正な成功例が残っていないことを確認する補助コマンドである。false positive があれば、validation failure 例として明示されているか確認する。

## 仕様 S2: Web lint remediation

### 対象ファイル

- `web/e2e/api-test.spec.ts`
- `web/src/contexts/LanguageContext.tsx`

### 変更仕様

#### S2-1 unused variable

`web/e2e/api-test.spec.ts` の未使用 `content` は、次のいずれかで解消する。

- assertion に利用する。
- 本当に不要なら削除する。

#### S2-2 Fast Refresh boundary

`web/src/contexts/LanguageContext.tsx` は React component と非 component export を同居させない。

許可される対応:

- constants / dictionaries / helper functions を `web/src/contexts/language-data.ts` などへ分離する。
- hook と provider の export が既存 import と互換になるように barrel export を維持する。

### 検証

```powershell
cd web
npm run lint
npm test
npm run build
```

## 仕様 S3: Agent route rate limit

### 対象ファイル候補

- `src/routes/agent-routes.ts`
- `src/app.ts`
- `src/auth/auth-plugin.ts`
- `test/routes.test.ts` または agent route 専用 test

### 対象 route

- `POST /v1/agent/register`
- `POST /v1/agent/unregister`

### 必須仕様

1. auth 有効時、未認証の register / unregister は拒否される。
2. rate limit が有効な環境では、短時間の連続 register / unregister を制限できる。
3. rate limit の設定値は既存 Fastify rate-limit 方針に合わせる。
4. テストでは、rate limit が global 適用か route 個別適用かを明確にする。

### 推奨実装

既存 global rate-limit plugin が全 route に効いている場合:

- agent route が対象外になっていないことをテストで確認する。
- docs / security note に根拠を残す。

個別指定が必要な場合:

- register / unregister route options に rate limit 設定を追加する。
- limit 値は既存 write endpoint と同等または厳しめにする。

### テスト観点

- auth disabled の local/dev path で既存テストが壊れない。
- auth enabled の protected path で API key なしは拒否される。
- rate limit 超過時に expected status を返す。
- successful register / unregister の既存挙動は変えない。

## 仕様 S4: code-to-gate false positive handling

### 対象 findings

| Finding | Path | Line | 初期判定 |
|---|---|---:|---|
| `finding-MISSING_INPUT_SANITIZATION-062` | `src/infrastructure/opencode-session-executor.ts` | 382 | SQL injection risk |
| `finding-MISSING_INPUT_SANITIZATION-063` | `src/infrastructure/session-executor/execute.ts` | 122 | SQL injection risk |
| `finding-MISSING_INPUT_SANITIZATION-064` | `src/store/control-plane-store.ts` | 529 | SQL injection risk |

### 実コード確認結果

上記 3 件は、検収時点の目視確認では SQL query ではなく、Error message または checkpoint summary の template literal であった。

### 変更仕様

実装者は各 finding について次を選ぶ。

#### Option A: suppression

実リスクでない場合、`.ctg/suppressions.yaml` に最小 scope の suppression を追加する。

必須フィールド:

```yaml
- rule_id: MISSING_INPUT_SANITIZATION
  path: src/infrastructure/opencode-session-executor.ts
  reason: "Template literal is an Error message, not SQL or shell execution. False positive confirmed by inspection."
  expiry: 2027-05-25
```

#### Option B: defensive hardening

ログや error body に外部入力が混ざるリスクを追加で下げたい場合、次を検討する。

- error body の長さ制限
- secret redaction
- control character removal
- structured logging への移行

この場合も SQL injection finding としては false positive であることを記録する。

### 禁止事項

- `.ctg/suppressions.yaml` で `path: src/**` のような broad suppression を追加しない。
- expiry のない suppression を追加しない。

## 仕様 S5: code-to-gate scoped acceptance

### 現状制約

`code-to-gate` の repo root full scan は、`shipyard-cp` の規模と現行 CLI の ignore 反映制約により timeout した。検収では scoped analysis を正とする。

### 正本コマンド

```powershell
cd C:\Users\ryo-n\Codex_dev\code-to-gate

node .\dist\cli.js analyze ..\shipyard-cp\src --emit all --out .\.shipyard-ctg\src --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\src --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\src --out .\.shipyard-ctg\src

node .\dist\cli.js analyze ..\shipyard-cp\packages --emit all --out .\.shipyard-ctg\packages --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\packages --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\packages --out .\.shipyard-ctg\packages

node .\dist\cli.js analyze ..\shipyard-cp\web\src --emit all --out .\.shipyard-ctg\web-src --policy ..\shipyard-cp\.ctg\policy.yaml --cache disabled --parallel 1
node .\dist\cli.js readiness ..\shipyard-cp\web\src --policy ..\shipyard-cp\.ctg\policy.yaml --from .\.shipyard-ctg\web-src --out .\.shipyard-ctg\web-src
```

### 合格条件

- `src` readiness が `blocked_input` ではない。
- `packages` readiness が `passed` または `passed_with_risk`。
- `web/src` readiness が `passed` または `passed_with_risk`。
- medium の `LARGE_MODULE` は Go 判定の blocker にしないが、保守性 follow-up として残す。

## 仕様 S6: Runtime smoke

### 目的

mock path だけでなく、少なくとも 1 つの worker runtime 経路で task lifecycle の最小 smoke を確認する。

### 対象候補

- OpenCode backend
- GLM backend
- local OpenAI-compatible runtime

### 最小フロー

1. backend 起動
2. `POST /v1/tasks`
3. `POST /v1/tasks/{task_id}/dispatch` with `target_stage=plan`
4. job / task status 確認
5. worker result 反映、または runtime 起因の expected degraded result 確認

### 証跡

検証結果には次を残す。

- 実行日時
- runtime 種別
- model / backend 名
- task id
- job id
- 最終 state
- 成功 / skip / degraded の理由

### skip 条件

外部 API key、OpenCode CLI、local runtime が存在しない場合、live smoke は skip してよい。ただし skip は Go 判定の confidence を下げるため、release 前には少なくとも 1 経路を実行する。

## Traceability

| Requirement | Spec | Test / Evidence |
|---|---|---|
| FR-001 | S1 | `rg typed_ref`, task creation smoke |
| FR-002 | S2 | `web npm run lint/test/build` |
| FR-003 | S3 | agent route auth / rate limit tests |
| FR-004 | S4 | `.ctg/suppressions.yaml`, `code-to-gate readiness` |
| FR-005 | S5 | scoped `code-to-gate` artifacts |
| FR-006 | S6 | runtime smoke log |

