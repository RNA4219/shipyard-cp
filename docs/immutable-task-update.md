# 不変 TaskUpdate パターン

## 概要

Control Plane における Task オブジェクトの状態管理を不変パターンに統一する。
直接ミューテーションを廃止し、全ての状態変更を `TaskUpdate` オブジェクトを通じて行う。

## 動機

### 以前の問題

```typescript
// 直接ミューテーション - デバッグ困難
task.state = 'developing';
task.active_job_id = job.job_id;
task.version += 1;
```

- 状態変更の追跡が困難
- テストで変更箇所を特定しにくい
- 同時更新時の競合検出ができない
- 監査ログとの整合性確認が煩雑

### 解決策

```typescript
// 不変更新パターン
const update: TaskUpdate = {
  active_job_id: job.job_id,
};
const updatedTask = applyTaskUpdate(task, update);
```

## インターフェース定義

### TaskUpdate

```typescript
interface TaskUpdate {
  // 直接置換フィールド
  artifacts?: ArtifactRef[];
  resolver_refs?: Partial<ResolverRefs>;
  external_refs?: ExternalRef[];
  context_bundle_ref?: string;
  rollback_notes?: string;
  last_verdict?: Verdict;
  last_failure_class?: FailureClass;
  loop_fingerprint?: string;
  detected_side_effects?: SideEffectCategory[];
  blocked_context?: BlockedContext;
  active_job_id?: string;
  manual_checklist?: Task['manual_checklist'];

  // マージフィールド
  mergeArtifacts?: ArtifactRef[];
  mergeResolverRefs?: Partial<ResolverRefs>;
  mergeExternalRefs?: ExternalRef[];
  retry_counts?: Partial<Record<WorkerStage, number>>;
}
```

### フィールド種別

| 種別 | フィールド | 動作 |
|------|-----------|------|
| **置換** | `artifacts`, `active_job_id`, etc. | 値を完全に置き換え |
| **マージ** | `mergeArtifacts`, `mergeExternalRefs`, etc. | 既存配列に追加（重複除外） |

## コア関数

### applyTaskUpdate

```typescript
function applyTaskUpdate(task: Task, update: TaskUpdate): Task
```

TaskUpdate を Task に適用し、新しい Task オブジェクトを返す。

### mergeTaskUpdates

```typescript
function mergeTaskUpdates(...updates: TaskUpdate[]): TaskUpdate
```

複数の TaskUpdate を単一の更新にマージする。

## Context インターフェース

全てのサービスContextインターフェースの `transitionTask` は `{ event, task }` を返す：

```typescript
interface XxxContext {
  transitionTask(
    task: Task,
    toState: Task['state'],
    input: ...
  ): { event: StateTransitionEvent; task: Task };
}
```

## 影響範囲

| モジュール | 変更内容 |
|-----------|---------|
| ResultOrchestrator | TaskUpdate返却、不変更新 |
| PublishOrchestrator | 不変タスク構築 |
| IntegrationOrchestrator | 不変タスク構築 |
| AcceptanceService | 返却タスク使用 |
| RunTimeoutService | 不変更新 |

## 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/domain/task/task-update.ts` | TaskUpdate interface, applyTaskUpdate, mergeTaskUpdates |
| `src/store/control-plane-store.ts` | updateTask, transitionTask 実装 |