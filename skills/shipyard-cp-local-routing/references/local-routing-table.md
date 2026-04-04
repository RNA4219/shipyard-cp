# shipyard-cp Local Routing Table

## 目的

shipyard-cp の task / run フローで、ローカルモデルと外部 provider の役割を固定しやすくする。

## ルール表

| フェーズ / 作業 | 既定モデル | 代替 | 理由 |
|---|---|---|---|
| task 正規化 | local `4B` | 外部小型 | 安い分類・整形で十分 |
| repo / worker ルーティング | local `4B` | なし | ルールベースに近く token 節約効果が高い |
| docs / logs の要約 | local `4B` | local `27B` | 精度より速度と安さを優先 |
| prompt 圧縮 / 観点抽出 | local `4B` | local `27B` | 前処理として軽く回したい |
| ドラフト生成 | local `27B` | 外部強モデル | 品質が必要だがローカルで賄えることが多い |
| 言い換え / リライト | local `27B` | 外部強モデル | 27B の方が明らかに安定しやすい |
| 低リスクレビュー第1パス | local `27B` | local `4B` | 第1パスで明らかな問題を拾う |
| acceptance 観点列挙 | local `4B` | local `27B` | 観点洗い出しは安く回せる |
| acceptance 最終判断 | 外部強モデル | local `27B` | ミス許容度が低い |
| integrate / publish 判断 | 外部強モデル | なし | 最終責任が重い |

## 推奨パターン

### 節約重視

1. `4B` で task 要約
2. `4B` で repo / worker ルーティング
3. 必要な文脈だけ外部 provider へ渡す

### バランス型

1. `4B` で圧縮と shortlist
2. `27B` でローカル下書き
3. 最終確認だけ外部 provider

### 品質重視

1. `4B` で不要文脈を落とす
2. 外部 provider で plan / dev / acceptance
3. ローカルは補助要約だけに留める

## shipyard-cp での考え方

- local は worker 本体を置き換えるより、前段処理と補助判断に入れると安定する。
- task seed を短くしてから外部へ出すと、token をかなり抑えやすい。
- gate の結論だけは高品質側へ寄せ、経緯ログは shipyard-cp 側へ残す。
