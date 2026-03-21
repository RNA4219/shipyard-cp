# `.claude/commands` 入口

このフォルダは `shipyard-cp` の product runtime ではなく、Claude Code から repo を運用するときの補助コマンド集です。  
日常運用の入口は `API` 直打ちではなく、ここにあるコマンドを起点にすると分かりやすくなります。

## 役割の違い

| コマンド | 役割 | 使う場面 |
|---|---|---|
| `run` | 単発の task を作成して dispatch する | まず 1 件だけ流したいとき |
| `status` | task / job / run の状態を見る | 今どうなっているか確認したいとき |
| `pipeline` | plan -> dev -> acceptance -> integrate -> publish を通しで追う | 一連の流れを最後まで見たいとき |

## 使い分け

- まず試すなら `run`
- 状態確認なら `status`
- フロー全体を追うなら `pipeline`

## 読み順

1. [run.md](./run.md)
2. [status.md](./status.md)
3. [pipeline.md](./pipeline.md)

## 補足

- これらは Claude Code 用の運用補助で、product の API 契約そのものではありません
- 実際の仕様や現在値は root の [docs/cli-usage.md](../../docs/cli-usage.md) を正本にしてください
