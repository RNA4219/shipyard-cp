---
name: shipyard-cp-cli-pipeline
description: shipyard-cp の plan -> dev -> acceptance -> integrate -> publish を Claude Code / Codex の補助コマンドで追いたいときに使う。
---

# shipyard-cp CLI Pipeline

フルフローを確認するときは、補助UIではなく Claude Code / Codex の補助コマンドで追う。

## 使う場面

- plan / dev / acceptance / integrate / publish の流れを追いたい
- リリース前に、どこまで自動で進みどこで人手確認が入るか確認したい
- task 1件を end-to-end で扱いたい

## 参照順

1. `docs/cli-usage.md`
2. `.claude/commands/pipeline.md`
3. `.claude/commands/run.md`
4. `.claude/commands/status.md`
5. `docs/project/RUNBOOK.md`

## 実運用ルール

- 日常運用は Claude Code / Codex コマンド経由の API 操作
- API 直打ちは補助用途
- acceptance の manual review と publish 承認の gate は、現在の運用フローに従って明示的に確認する
- 問題が出たら `status` で task / events / runs を確認してから UI を見る

## 確認ポイント

- task state が期待どおりに進むこと
- run timeline と task events に矛盾がないこと
- integrate / publish は policy gate を飛ばさないこと
- 高リスク task では acceptance / publish の確認ログが残ること

## 迷ったとき

- 操作入口で迷ったら `.claude/commands/*.md` を優先
- 契約や仕様で迷ったら `docs/api-contract.md` と `docs/openapi.yaml` を見る
- 実装上の現在値で迷ったら `docs/project/RUNBOOK.md` を見る
