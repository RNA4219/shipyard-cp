# Acceptance Completion Spec (2026-03-22)

## 背景

`shipyard-cp` は backend/API を Claude Code や Codex から直接呼び出す使い方を本命とするが、acceptance worker が `accept` verdict を返しても task は `accepting`、run は `running` のまま止まり、別途 `/v1/tasks/:task_id/acceptance/complete` を operator が呼ばないと先に進めなかった。

補助UI 側もこの completion API を叩く導線がなく、`accepting` task を画面から閉じられなかった。

## 問題

1. backend-first の主導線が hidden manual step を前提にしており、自動フローとして完結しない。
2. acceptance 完了 API は存在するが、補助UI から呼べない。
3. `accept` verdict と `needs_manual_review` / checklist 未完了 / stale docs などの manual gate が混同されている。

## 仕様

### 1. backend の既定動作

- acceptance worker の result に `verdict.outcome = "accept"` が含まれる場合、control plane は worker result を task に反映したうえで、自動的に acceptance completion を試行する。
- 自動 completion は既存の `AcceptanceService.completeAcceptance()` を使用し、manual checklist / verdict / stale docs / log artifact などの gate をそのまま評価する。
- gate を全て満たした場合:
  - task は `accepted` に遷移する
  - run も terminal 側へ進む
  - result の `next_action` は `integrate` を返す
- gate を満たさない場合:
  - task は `accepting` に留まる
  - `last_verdict` は保持する
  - result の `next_action` は `wait_manual` を返す

### 2. manual completion API の位置づけ

- `/v1/tasks/:task_id/acceptance/complete` は削除しない。
- この API は「自動 completion が gate で止まった時の補助導線」として残す。
- operator が checklist の確認や override verdict を与えたい場合も、この API を利用する。

### 3. 補助UI の動作

- task detail に `受け入れ完了` ボタンを追加する。
- ボタンは task が `accepting` の時のみ表示する。
- 押下時は `/v1/tasks/:task_id/acceptance/complete` を呼び、成功時に task/runs を再取得する。
- backend が自動 completion に成功した通常ケースでは task がすぐ `accepted` へ進むため、このボタンは実質的に出番がない。
- checklist gate などで `accepting` に残ったケースだけ、補助UI から回収できる。

## 実装方針

### backend

- `ResultOrchestrator` の acceptance 成功分岐を変更し、`accept` verdict 時に:
  1. worker result を task に反映
  2. store に一旦保存
  3. `AcceptanceService.completeAcceptance()` を試行
  4. 失敗時だけ `wait_manual` にフォールバック

### frontend

- `api.ts` に `completeAcceptance(taskId)` を追加
- `useTasks.ts` に `useCompleteAcceptance()` を追加
- `TaskDetail.tsx` に `受け入れ完了` ボタンを追加

## 受け入れ条件

1. API-first で `create -> plan -> dev -> acceptance(result verdict=accept)` を通した時、gate が成立する task は追加 API 呼び出しなしで `accepted` に進む。
2. gate が不成立の task は `accepting` に留まり、`last_verdict` は保持される。
3. 補助UI から `accepting` task に対して `受け入れ完了` を実行できる。
4. `npm run build` と `npm test` が frontend/backend で通る。
