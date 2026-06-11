---
name: shipyard-cp-cli-quickstart
description: shipyard-cp を Claude Code / Codex の補助コマンドから日常運用するときに使う。task 作成、進捗確認、基本導線を辿りたい場合に使う。
---

# shipyard-cp CLI Quickstart

shipyard-cp は `.claude/commands/` の補助コマンドを入口に使う。これは実 CLI バイナリではなく、Claude Code / Codex が API 操作を行うための手順である。

## 使う場面

- 新しく shipyard-cp の使い方を把握したい
- 1件の task を作成して流したい
- task / run の状態を確認したい
- API 契約ではなく実運用の入口を知りたい

## 入口

最初に次の順で読む。

1. `docs/cli-usage.md`
2. `README.md`
3. `.claude/commands/run.md`
4. `.claude/commands/status.md`
5. 必要なら `.claude/commands/pipeline.md`

## 基本方針

- 人が触る主導線は Claude Code / Codex コマンド経由の API 操作
- `docs/api-contract.md` と `docs/openapi.yaml` は internal contract 用
- worker へ渡す追加ガイダンスは API の `skills` ではなく prompt / references に展開される

## 最短手順

1. 依存を入れる: `pnpm install`
2. 開発サーバーを上げる: `pnpm run dev`
3. `.claude/commands/run.md` に沿って task を作成して dispatch する
4. `.claude/commands/status.md` に沿って task / run / event を確認する

## 補足

- repo や worker を毎回明示したくないときは、保存済み repo 設定や既定値を優先してよい
- 緊急時やデバッグ時のみ API 直打ちへ降りる
- frontend は補助UI。本体導線は backend / worker / Claude Code・Codex コマンドと考える
