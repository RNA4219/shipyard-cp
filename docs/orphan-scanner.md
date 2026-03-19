# OrphanScanner

## 概要

孤児化したジョブ（Worker Job）を定期的に検出し、自動回復アクションを実行するスキャナー。

## 用語定義

### 孤児ジョブ (Orphan Job)

以下の条件を満たすジョブ：

1. アクティブなジョブ（リース保有中）
2. リース期限が切れている
3. タスクが進行中の状態（planning, developing, accepting, integrating, publishing）

### 孤児化の原因

| 原因 | 頻度 | 検出方法 |
|------|------|---------|
| Worker プロセスクラッシュ | 高 | リース期限切れ |
| ネットワーク分断 | 中 | heartbeat 停止 |
| リソース不足による停止 | 中 | プロセス監視 |
| API タイムアウト | 低 | heartbeat 確認 |

## インターフェース定義

### OrphanScannerConfig

```typescript
interface OrphanScannerConfig {
  /** スキャン間隔 (ミリ秒) */
  scanIntervalMs: number;           // デフォルト: 60000 (1分)

  /** リース期限切れと判定する猶予時間 (ミリ秒) */
  leaseExpiryThresholdMs: number;   // デフォルト: 0 (即座に)

  /** 1回のスキャンで処理する最大孤児数 */
  maxOrphansPerScan: number;        // デフォルト: 10

  /** 自動回復を有効にするか */
  autoRecoveryEnabled: boolean;     // デフォルト: true
}
```

### OrphanJob

```typescript
interface OrphanJob {
  job_id: string;
  task_id: string;
  stage: WorkerStage | ControlPlaneStage;
  worker_type: WorkerType;
  lease_expires_at: string;
  orphaned_duration_ms: number;
  task_state: TaskState;
}
```

### RecoveryAction

```typescript
type RecoveryAction =
  | { type: 'blocked'; reason: string }
  | { type: 'retry'; scheduled_at: string }
  | { type: 'fail'; reason: string };
```

## 回復ポリシー

### ステージ別回復アクション

| ステージ | 回復アクション | 理由 |
|---------|--------------|------|
| plan | retry | 別ワーカーで再実行可能 |
| dev | blocked | 部分的な成果を保護 |
| acceptance | blocked | 手動確認が必要 |
| integrate | blocked | 統合状態を保護 |
| publish | blocked | 重要な操作のため保護 |

## 監査イベント

### 検出時

```json
{
  "event_type": "run.orphanDetected",
  "payload": {
    "job_id": "job_abc123",
    "task_id": "task_xyz",
    "stage": "dev",
    "orphaned_duration_ms": 120000
  }
}
```

### 回復実行時

```json
{
  "event_type": "run.orphanRecovered",
  "payload": {
    "job_id": "job_abc123",
    "recovery_action": "blocked"
  }
}
```

## 使用方法

```typescript
import { OrphanScanner } from './domain/orphan/index.js';

const scanner = new OrphanScanner(store, {
  scanIntervalMs: 60000,
  autoRecoveryEnabled: true,
});

// スキャン開始
scanner.start();

// スキャン停止
scanner.stop();
```

## 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/domain/orphan/orphan-scanner.ts` | OrphanScanner クラス |
| `src/domain/orphan/orphan-recovery.ts` | OrphanRecovery, 回復ロジック |

## 設定推奨値

### 開発環境

```typescript
{
  scanIntervalMs: 30000,      // 30秒
  autoRecoveryEnabled: true,
}
```

### 本番環境

```typescript
{
  scanIntervalMs: 60000,      // 1分
  leaseExpiryThresholdMs: 30000, // 30秒の猶予
  autoRecoveryEnabled: true,
}
```