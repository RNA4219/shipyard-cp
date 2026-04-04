`shipyard-cp` でローカル LLM と外部 provider をどう混ぜるか決めたいときに使う。

読む順番:

1. `skills/shipyard-cp-local-routing/references/local-routing-table.md`
2. `skills/shipyard-cp-local-routing/SKILL.md`
3. 必要なら `skills/shipyard-cp-cli-quickstart/SKILL.md`

基本方針:

- `Qwen3.5-4B` は routing、要約、分類、圧縮、観点抽出に使う
- `Qwen3.5-27B` は下書き生成、リライト、低リスクレビュー第1パスに使う
- 高リスク実装や最終 gate は外部 provider を優先する

ローカル runtime の起動確認が必要なら、グローバル command を使う:

- `/local-llm:start`
- `/local-llm:status`
- `/local-llm:verify`
- `/local-llm:stop`
