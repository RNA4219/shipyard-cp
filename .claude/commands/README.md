# `.claude/commands` 入口

このフォルダはClaude Code / Codexから実行可能な `shipyard` CLIを使うための薄いラッパーです。
HTTPや認証処理を再実装せず、product runtimeと同じCLI契約を使用します。

| command | CLI | purpose |
|---|---|---|
| run | `shipyard run` | Task作成と単一stage dispatch |
| status | `shipyard status` | Task・event・watch |
| pipeline | `shipyard pipeline` | planからpublishまで。手動gateで停止 |
| accept | `shipyard accept` | manual checklistとAcceptance完了 |
| local-routing | CLIのworker指定 | local/external worker選択 |

API直打ちはCLI障害の診断時だけ使用します。正本は [CLI Usage](../../docs/cli-usage.md) です。
