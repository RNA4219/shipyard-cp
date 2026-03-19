# ADR-0001: 依存 OSS との責務境界と正本の配置

- Status: Accepted
- Date: 2026-03-20

## Context

- `shipyard-cp` は単独で task state、tracker 連携、docs resolver を抱え込むのではなく、既存 OSS と接続して Control Plane を構築する前提で設計されている。
- 一方で、`agent-taskstate`、`memx-resolver`、`tracker-bridge-materials` のどこを正本とするかが曖昧だと、状態不整合、typed_ref の揺れ、責務重複が起きやすい。
- 実装上も `typed_ref` の canonical form、state mapping、resolver refs、tracker external refs は複数モジュールにまたがっており、設計判断を 1 か所に固定しておく必要がある。
- 特に `integrate` / `publish` は worker job ではなく Control Plane run として扱っており、依存 OSS の責務境界と合わせて説明できる文書が必要だった。

## Decision

- `agent-taskstate` を internal task state contract の正本とし、shipyard-cp は独自 state machine を持ちながらも、canonical state・`typed_ref`・context bundle の前提をこれに整合させる。
- `tracker-bridge-materials` は external tracker helper layer として使い、tracker 側の state や issue 情報で shipyard-cp の内部状態を上書きしない。
- `memx-resolver` は docs resolve、chunk / contract 参照、read ack、stale 判定の責務を持ち、shipyard-cp はその結果を orchestration の入力として消費する。
- shipyard-cp 自身は orchestration / policy / approval / audit / integrate / publish に責務を集中させ、依存 OSS の置き換えはしない。
- すべての参照は canonical `typed_ref` と `external_refs` / `resolver_refs` で接続し、connector 単位で型変換・再試行・障害隔離を行う。
- `integrate` / `publish` は worker capability ではなく Control Plane policy gate で管理し、`WorkerJob.stage` の拡張では表現しない。

## Alternatives Considered

### 1. shipyard-cp を全面的な正本にする

- task state、tracker 参照、docs resolve 結果を shipyard-cp 内に閉じ込める案。
- 実装は単純に見えるが、既存 OSS と仕様差分が発生しやすく、typed_ref や state transition の互換性維持コストが高い。

### 2. tracker を task state の正本に寄せる

- GitHub Projects や外部 issue tracker の state を実質的な primary status にする案。
- 外部システム都合で internal orchestration state が揺れるため、Plan / Dev / Acceptance / Integrate / Publish の責任分離と相性が悪い。

### 3. resolver の結果を task payload に埋め込んで独自管理する

- resolve / ack / stale を shipyard-cp 側モデルへ吸収する案。
- resolver 基盤の進化と切り離せず、重複実装が増えるため採用しない。

## Consequences

- shipyard-cp の中核変更では、まず「これは orchestration の責務か、OSS connector の責務か」を判断できるようになる。
- `typed_ref`、state mapping、context bundle、external refs の変更は、依存 OSS との整合確認を伴う変更として扱う必要がある。
- tracker 連携は常に helper 扱いなので、外部 tracker の同期遅延や欠損があっても internal task state は守られる。
- resolver の stale 判定や contract 解決を shipyard-cp へ複製しない前提になるため、接続障害時は degrade / retry / block の運用設計が重要になる。
- 新しい OSS や provider を追加するときは state machine や監査スキーマを直接広げる前に connector 追加で吸収できるかを優先して検討する。

## Implementation Notes

- `src/domain/typed-ref/typed-ref-utils.ts` で canonical `typed_ref` を検証・正規化する。
- `src/domain/state-machine/state-mapping.ts` で shipyard-cp の内部状態を `agent-taskstate` の canonical state に写像する。
- `src/domain/resolver/resolver-service.ts` は `memx-resolver` を前提に doc / chunk / contract / ack を扱う。
- `src/domain/tracker/tracker-service.ts` は tracker entity を `external_refs` と `sync_event_ref` に正規化して task へ接続する。
- `docs/api-contract.md`、`docs/implementation-prep.md`、`REQUIREMENTS.md` の責務境界は本 ADR を前提に読み解く。
