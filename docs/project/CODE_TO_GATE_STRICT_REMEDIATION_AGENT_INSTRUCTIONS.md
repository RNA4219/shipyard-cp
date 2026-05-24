---
intent_id: SHIPYARD-CTG-STRICT-REMEDIATION
owner: shipyard-cp
status: draft
last_reviewed_at: 2026-05-25
next_review_due: 2026-06-25
---

# code-to-gate strict remediation agent instructions

## 目的

この指示書は、`ADD_REQUIREMENTS_3` の PR-A P0 fail-closed 修正が検収済みである前提で、残っている `code-to-gate strict` の `blocked_input` を次の実装エージェントが安全に解消するための作業指示である。

PR-A の範囲である authority conflict、schema retry、acceptance evidence manual gate は合格済みとして扱う。ここでは repo 全体の strict readiness blocker を、実修正が必要なもの、false positive として根拠整理すべきもの、別 PR に分離すべきものに分けて対応する。

## 現在の判定

最終確認日: 2026-05-25

```text
code-to-gate analyze:
- raw findings: 99
- critical: 3
- high: 28
- medium: 67
- low: 1

code-to-gate readiness --policy strict:
- status: blocked_input
- effective findings: 82
- failed conditions: 49
```

成果物:

```text
C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full\findings.json
C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full\analysis-report.md
C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full\release-readiness.json
```

## 作業原則

1. PR-A の fail-closed 挙動を壊さない。
2. `code-to-gate strict` の critical/high を先に潰す。
3. false positive は黙って suppression しない。根拠をコード、テスト、ドキュメントのいずれかに残す。
4. 大規模リファクタリングは避け、1 PR 1 リスクカテゴリを目安に分ける。
5. 既存テストが通るだけでなく、該当 risk に対する regression test を追加する。
6. `ResultOrchestrator` など ADD_REQUIREMENTS_3 周辺ファイルの medium large module は、今回の critical/high 解消を邪魔しない範囲で follow-up とする。

## 推奨 PR 分割

### PR-B: agent registration rate limit

目的:

- `/v1/agent/register`
- `/v1/agent/unregister`

上記 sensitive endpoint の `MISSING_RATE_LIMIT` high finding を解消する。

対象候補:

- `src/routes/agent-routes.ts`
- 既存の auth / rate limit middleware
- `test/agent-routes.test.ts`
- `test/auth/auth-plugin.test.ts`

実装指示:

1. 既存の route registration と middleware 構成を読む。
2. 既存 rate limit 実装がある場合は再利用する。
3. 既存実装がない場合は、route-local な小さい limiter を追加する。ただし全体設計に乗せられる名前と境界にする。
4. register / unregister の両方に同じ policy を適用する。
5. auth disabled のテストを壊さない。
6. rate limit 超過時の status code、response body、audit / log の期待をテストで固定する。

受入条件:

- `MISSING_RATE_LIMIT` finding が 0 になる、または strict readiness 上の blocker から外れる。
- register / unregister の正常系テストが通る。
- rate limit 超過テストが追加される。

重点テスト:

```bash
npx vitest run test/agent-routes.test.ts test/auth/auth-plugin.test.ts --reporter=dot
npm run check
```

### PR-C: command/input sanitization triage and fixes

目的:

以下の critical finding を解消または根拠付きで false positive 化する。

| Finding | 対象 | 現在の CTG 表示 |
|---|---|---|
| `MISSING_INPUT_SANITIZATION` | `src/store/control-plane-store.ts:529` | SQL injection risk |
| `MISSING_INPUT_SANITIZATION` | `src/infrastructure/opencode-session-executor.ts:382` | SQL injection risk |
| `MISSING_INPUT_SANITIZATION` | `src/infrastructure/session-executor/execute.ts:122` | SQL injection risk |

対象候補:

- `src/store/control-plane-store.ts`
- `src/infrastructure/opencode-session-executor.ts`
- `src/infrastructure/session-executor/execute.ts`
- 関連する worker/session executor tests

実装指示:

1. 各 finding の該当行を読み、実際に SQL / shell / command / path injection の入口か分類する。
2. SQL でない場合も、外部入力が command argument、path、env、script body に流れていないか確認する。
3. true positive の場合は、文字列連結をやめて structured API、allowlist、argument array、path normalization のいずれかで閉じる。
4. false positive の場合は、なぜ SQL injection ではないかを短いコードコメントまたは security note に残す。
5. CTG が誤検知し続ける場合だけ、最小範囲の suppression を追加する。suppression には根拠、期限、再確認コマンドを書く。

受入条件:

- critical finding 3 件が解消される、または根拠付き accepted exception として扱える。
- 外部入力が command / path / SQL-like sink に入る経路の regression test がある。
- `npm test` と `code-to-gate readiness` で critical blocker が残らない。

重点テスト:

```bash
npx vitest run test/opencode-serve-adapter.test.ts test/worker-executor.test.ts test/control-plane-store.test.ts --reporter=dot
npm run check
```

### PR-D: unsafe delete audit and narrowing

目的:

`UNSAFE_DELETE` high finding 19 件を、true positive 修正、safe wrapper 化、または false positive 根拠整理に分けて処理する。

主な対象:

- `src/domain/concurrency/concurrency-manager.ts`
- `src/domain/doom-loop/doom-loop-detector.ts`
- `src/domain/github-projects/github-projects-service.ts`
- `src/domain/tracker/tracker-service.ts`
- `src/domain/worker/worker-adapter.ts`
- `src/domain/worker/worker-executor.ts`
- `src/monitoring/errors/alert-manager.ts`
- `src/monitoring/errors/error-tracker.ts`
- `src/monitoring/metrics/metrics-collector.ts`
- `src/store/services/audit-service.ts`
- `src/store/services/job-service.ts`
- `src/store/services/task-service.ts`
- `src/store/store-backend.ts`

実装指示:

1. 各 finding が filesystem delete か、Map / Set / in-memory cleanup か分類する。
2. filesystem delete なら resolved path が intended workspace / temp root 配下に収まることを検証する。
3. in-memory cleanup なら、命名または helper 化で CTG が安全意図を読みやすい形にする。
4. TTL / retention cleanup は、削除対象の owner、scope、upper bound をテストで固定する。
5. `.ctg/suppressions.yaml` の broad suppression は増やさない。必要なら finding 単位に狭める。

受入条件:

- `UNSAFE_DELETE` high finding が大幅に減る。
- 残す finding は false positive 根拠と期限付き follow-up がある。
- cleanup 系 regression test が追加される。

重点テスト:

```bash
npx vitest run test/concurrency-manager.test.ts test/doom-loop.test.ts test/store-backend.test.ts test/job-service.test.ts --reporter=dot
npm run check
```

### PR-E: hardcoded secret false positive cleanup

目的:

`HARDCODED_SECRET` high finding 7 件を分類し、実 secret なら修正、false positive なら検出されにくい表現または根拠付き exception にする。

対象候補:

- `src/domain/worker/antigravity-adapter.ts`
- `src/domain/risk/risk-integration-service.ts`
- `src/domain/github-environments/github-environments-service.ts`
- `src/domain/checklist/manual-checklist-service.ts`

実装指示:

1. finding の変数名、値、用途を確認する。
2. 実 secret、token、credential、private key ではないことを確認する。
3. 設定例や説明文が誤検知されている場合は、定数名や説明文を具体化する。
4. 実 secret に見える placeholder は `EXAMPLE_` prefix などに寄せる。
5. false positive を suppression する場合は最小 path / rule / evidence hash に限定する。

受入条件:

- high severity の `HARDCODED_SECRET` が 0 になる、または accepted exception として根拠が残る。
- 実 secret が repository に存在しないことを確認する。

重点テスト:

```bash
npx vitest run test/antigravity-adapter.test.ts test/risk-integration.test.ts test/manual-checklist.test.ts --reporter=dot
npm run check
```

## PR-A 回帰防止チェック

どの PR でも、最後に PR-A の P0 fail-closed 回帰を必ず確認する。

```bash
npx vitest run test/authority-conflict.test.ts test/schema-validator.test.ts test/stage-semantic-validator.test.ts test/result-orchestrator.test.ts --reporter=dot
```

見ること:

- authority conflict が `blocked` / `wait_manual` に落ちる。
- schema / parse error が retry policy に乗る。
- acceptance `accept` evidence 欠損が manual gate に落ちる。
- `needs_manual_review` が自動 accept されない。

## 最終再検収コマンド

各 PR の最後に実行する。

```bash
npm run check
npm test
npm run build
```

`code-to-gate` は長めタイムアウトで実行する。

```bash
node C:\Users\ryo-n\Codex_dev\code-to-gate\dist\cli.js analyze C:\Users\ryo-n\Codex_dev\shipyard-cp --emit all --out C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full
node C:\Users\ryo-n\Codex_dev\code-to-gate\dist\cli.js readiness C:\Users\ryo-n\Codex_dev\shipyard-cp --policy C:\Users\ryo-n\Codex_dev\code-to-gate\fixtures\policies\strict.yaml --from C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full --out C:\Users\ryo-n\Codex_dev\code-to-gate\.shipyard-ctg-addreq3-full
```

## 完了判定

最低ライン:

- critical finding: 0
- high finding: 既存 policy threshold 以下、または accepted exception として根拠付き
- strict readiness: `pass`、または残 blocker が明確に別 PR として文書化済み
- PR-A の fail-closed regression: pass
- `npm run check` / `npm test` / `npm run build`: pass

理想ライン:

- `code-to-gate readiness --policy strict` が `pass`
- `.ctg/suppressions.yaml` の broad suppression debt が増えていない
- security category blocker が 0

## エージェントへの初回指示文

次の文面をそのまま実装エージェントに渡してよい。

```text
C:\Users\ryo-n\Codex_dev\shipyard-cp を対象に、code-to-gate strict readiness の blocked_input を解消してください。

前提:
- ADD_REQUIREMENTS_3 の PR-A P0 fail-closed 修正は検収済みです。
- authority conflict / schema retry / acceptance evidence manual gate の挙動は壊さないでください。
- 詳細指示は docs/project/CODE_TO_GATE_STRICT_REMEDIATION_AGENT_INSTRUCTIONS.md を正本として読んでください。

最初の優先順位:
1. PR-B として src/routes/agent-routes.ts の /v1/agent/register と /v1/agent/unregister に rate limit を追加し、MISSING_RATE_LIMIT high finding を解消してください。
2. 変更後、test/agent-routes.test.ts と関連 auth test に rate limit 超過ケースを追加してください。
3. PR-A 回帰防止として authority-conflict/schema/stage-semantic/result-orchestrator の focused tests も実行してください。
4. 最後に npm run check、npm test、npm run build、code-to-gate analyze/readiness を長めタイムアウトで実行し、結果を報告してください。

制約:
- false positive は黙って suppression しないでください。
- suppression が必要な場合は finding 単位に狭くし、根拠と再確認コマンドを残してください。
- unrelated な既存変更は戻さないでください。
```
