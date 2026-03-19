# Architecture Decision Records (ADR)

| 番号 | タイトル | ステータス | 概要 |
| --- | --- | --- | --- |
| [ADR-0001](./ADR-0001-oss-boundary-and-source-of-truth.md) | 依存 OSS との責務境界と正本の配置 | Accepted | `agent-taskstate` / `memx-resolver` / `tracker-bridge-materials` の境界を固定し、shipyard-cp が orchestration と統治に責務集中する方針を明文化する。 |

`shipyard-cp` の設計判断を短時間で参照できるようにするための索引です。
構造や責務境界を変える判断を追加したときは、ここに 1 行追記します。

## 追加ルール

- ファイル名は `ADR-<連番>-<slug>.md` とする
- ステータス、日付、背景、決定、影響を最低限残す
- README / REQUIREMENTS / RUNBOOK / 実装のどこに効く判断かを本文に書く
