# shipyard-cp 追加機能追補要件書

## 位置づけ

本書は、`shipyard-cp` に対する追加機能要件を整理する追補文書である。仕様の正本は [REQUIREMENTS.md](./REQUIREMENTS.md)、実装順序と現状の正本は [RUNBOOK.md](./RUNBOOK.md) とし、本書はそれらを変更せずに **Run 可視化 / 実行後レトロスペクティブ / ステージ境界 Git チェックポイント** を追加するための補助要件として扱う。

本書の目的は次の 3 点である。

- 既存の Control Plane 要件と矛盾しない形で追加機能を定義する
- `RUNBOOK.md` の実装順序・既存完了状況に沿って導入順を固定する
- 将来の実装時に「何を既存機能に乗せ、何を新設するか」を明確にする

---

## エグゼクティブサマリー

shipyard-cp は既に `REQUIREMENTS.md` で、LiteLLM を推論経路の標準入口とし、`agent-taskstate` を内部 task state の正本、`tracker-bridge-materials` を tracker helper layer、`memx-resolver` を docs / memory resolver 基盤として扱う Control Plane であることが固定されている。また `RUNBOOK.md` によれば、Task 入力境界、resolver 接続、worker orchestration、tracker 接続、Integrate / Publish、実行信頼性追補は完了している。

この前提の上で、本書では次の追加機能を定義する。

1. **Run 可視化**
   - Task / Job / stage event / audit event をもとに、実行の進捗・停滞・承認待ち・完了を一覧および詳細で可視化する
2. **実行後レトロスペクティブ**
   - Run 完了後に、duration / usage / cost / file change / verdict / publish 結果を集約し、自然言語要約とともに閲覧できるようにする
3. **ステージ境界 Git チェックポイント**
   - `developing` / `accepted` / `integrated` / `published` などの責任境界で、Git 上の参照可能な checkpoint を残し、監査と再開判断に使えるようにする

これらは新しい state machine を導入するものではなく、既存の `REQUIREMENTS.md` に定義された state / approval / risk / integrate / publish / audit の仕組みを拡張して、運用可視性と監査可能性を高めるものである。

---

## 既存文書との整合方針

### REQUIREMENTS.md との整合

本追補は、以下の既存決定を変更しない。

- `agent-taskstate` を内部 state の正本とする
- `tracker-bridge-materials` を helper layer とし、外部 tracker を正本にしない
- `memx-resolver` を docs resolve / ack / stale / contract resolve の基盤とする
- `main` 更新は Publish ではなく Integrate の責務とする
- Publish は Dry-run デフォルト、Apply は明示承認付きとする
- Acceptance は手動必須、かつ risk-based testing を採用する
- PR 無し運用では integration branch で検証後に bot が main を更新する

したがって、追加機能は必ず既存の canonical typed_ref、Task / WorkerJob / WorkerResult、audit event、integration / publish policy の上に積むこと。

### RUNBOOK.md との整合

`RUNBOOK.md` では Step 1〜6 が完了しているため、本追補の追加機能は新規基盤構築ではなく、**既存ドメインと API を再利用する二次機能**として導入する。

前提として再利用する既存資産:

- `StateTransitionEvent`
- `WorkerJob` / `WorkerResult`
- `RiskAssessor`
- `RepoPolicyService`
- `BaseShaValidator`
- `SideEffectAnalyzer`
- `LeaseManager` / `RetryManager` / `ConcurrencyManager`
- `GitHubProjectsService`
- `GitHubEnvironmentsService`
- `ContextBundleService`
- `WorkspaceManager`

新機能は、これらを壊さずに read model / view model / summary generation / checkpoint recording を追加する方向で設計する。

### 実装前に固定する用語

将来の実装ぶれを避けるため、本書では次の語を固定する。

- **Task**: `agent-taskstate` と整合する正本エンティティ。外部 API でも主キーは `task_id` を維持する
- **Run**: 1 つの Task にひもづく 1 回の実行試行。再実行・再開・再投入が起きるため、`task_id` とは別に `run_id` を持つ read model とする
- **Attempt**: 同一 Run の中での worker retry / stage retry の単位。原則として UI の主一覧単位にはしない
- **Checkpoint**: 特定 state 境界で採取した Git 参照または approval 証跡への参照であり、state machine の正本ではない

以後、追加 API で `run` を表現する場合でも、Task 正本との対応を必ず保持し、`task_id` だけを Run の一意キーにしないこと。

---

## 対象機能

### 1. Run 可視化

#### 目的

Control Plane 上で動く Task / Job / stage の流れを、オペレータ・レビュア・監査者が追えるようにする。既存の state machine、retry、heartbeat、lock、approval、publish gate を、単なる内部実装ではなく運用上の可視情報として提示することが狙いである。

#### 可視化対象

最低限、以下を可視化対象とする。

- Task の現在状態
- Run ごとの進行状況
- stage 単位の進行状況
- worker job の開始 / 完了 / blocked / retry / orphan / capability mismatch
- manual acceptance の待機 / 実施 / 不合格
- integrate の checks 実行状況、base SHA 再確認、bot push 結果
- publish の mode（no-op / dry-run / apply）と approval 状態
- resolver stale 判定の有無
- tracker / project item の関連参照

#### データソース

Run 可視化は新しい正本を持たず、以下から view を構築する。

- Task state
- `StateTransitionEvent`
- `WorkerJob`
- `WorkerResult`
- retry / lease / heartbeat / lock / capability / loop 関連監査イベント
- integrate / publish run metadata
- external refs（tracker item, GitHub Project item, Git commit, deployment ref など）

#### Read model の要件

Run read model は最低限、次を持つ。

- `run_id`
- `task_id`
- `run_sequence`
- `status`
- `current_stage`
- `started_at`
- `ended_at`
- `last_event_at`
- `projection_version`
- `source_event_cursor`

`projection_version` と `source_event_cursor` を持たせ、表示内容がどのイベント位置まで反映済みか追えるようにすること。これにより、投影遅延や再構築時の不整合を検知可能にする。

#### 必須表示要件

- **Run 一覧**
  - run_id
  - task_id
  - objective の要約
  - 現在 state
  - risk_level
  - 現在 stage
  - owner / actor
  - 最終更新時刻
  - blocked の有無
  - publish plan の有無
- **Run 詳細**
  - state 遷移タイムライン
  - stage ごとの開始 / 完了時刻
  - worker 種別と capability 判定結果
  - manual acceptance の実施ログ
  - integrate / publish の判定根拠
  - checkpoint された Git 参照
  - retrospective へのリンク
  - projection freshness（どの event cursor まで反映済みか）
- **監査者向け詳細**
  - retry 回数
  - heartbeat 欠落
  - orphan recovery 判定
  - lock conflict
  - approval 要求内容
  - side-effect category
  - stale docs / contract refs

#### UI / API 要件

追加 API の候補:

- `GET /v1/runs`
- `GET /v1/runs/{run_id}`
- `GET /v1/runs/{run_id}/timeline`
- `GET /v1/runs/{run_id}/audit-summary`
- `GET /v1/tasks/{task_id}/runs`

実装上は既存正本から read model を構築し、書き込み責務を増やさないこと。まずは API / CLI / JSON 出力から始め、UI は後続でもよい。

---

### 2. 実行後レトロスペクティブ

#### 目的

Run 完了後に「何が起き、何が変わり、どこで止まり、何を承認し、どんな副作用が発生したか」を短時間で理解できるようにする。既存の監査ログは粒度が細かいため、関係者向けには集約ビューが必要である。

#### 生成タイミング

- Run が `integrated` または `published` に到達した時
- `blocked` / `failed` で終了した場合も失敗レトロスペクティブを生成可能にする
- 手動再生成を許可する

#### 集約対象

最低限、以下を集約する。

- 実行時間（total / stage 別）
- worker job 数、成功数、失敗数、blocked 数
- retry 回数
- manual acceptance 実施結果
- risk level と forced-high 判定理由
- LiteLLM usage / cost / routing / fallback
- 変更ファイル数、差分量、関連 commit / branch / tag
- integrate の checks 結果
- publish mode / approval / idempotency key / 外部副作用結果
- resolver 参照文書、stale 判定、ack 状況
- tracker / project item / deployment / release の外部参照

#### ナラティブ生成

要約ナラティブは LiteLLM 経由で生成してよいが、以下を守ること。

- raw audit log をそのまま投げず、先に構造化メトリクスへ集約する
- secrets や不要な raw prompt を要約入力へ含めない
- 失敗時はナラティブ未生成でも structured summary は返す
- 生成モデル名、生成時刻、入力バージョンを保持する
- ナラティブは再生成可能だが、過去生成物を破壊的に上書きせず履歴を残せるようにする

#### データモデル要件

`Retrospective` あるいは同等の read model を追加し、次を持つ。

- `retrospective_id`
- `run_id`
- `task_id`
- `generation`
- `status`
- `generated_at`
- `summary_metrics`
- `narrative`
- `source_refs`
- `generation_metadata`

この read model は Task 正本を置き換えず、再生成可能であること。また 1 Task 1 件前提にはせず、**Run 単位**で保持すること。

#### 失敗時の扱い

- summary metrics 集約に失敗した場合は `status=failed` とし、失敗理由を保持する
- LiteLLM 生成だけ失敗した場合は `status=partial` とし、structured summary は返す
- stale な retrospective を返す場合は freshness を明示する

#### API 要件

- `GET /v1/runs/{run_id}/retrospective`
- `POST /v1/runs/{run_id}/retrospective:generate`
- `GET /v1/tasks/{task_id}/retrospectives`

---

### 3. ステージ境界 Git チェックポイント

#### 目的

責任境界ごとに Git 上で再参照可能な checkpoint を残し、監査・差分確認・再開判断・失敗分析に使えるようにする。ここでいう checkpoint は「state machine の正本」ではなく、「その時点の repo 状態と運用判断を示す Git 参照」である。

#### 原則

- `main` 更新の責務は引き続き Integrate に置く
- checkpoint は PR ベースを必須とせず、既存 direct-to-main 方針と矛盾させない
- `BaseShaValidator` と `RepoPolicy` を尊重する
- bot push 制限、integration branch、publish approval gate を迂回しない
- approval の証跡と code snapshot を同一概念に混同しない

#### checkpoint 取得ポイント

最低限の checkpoint 候補:

- `developing` 完了時
- `accepted` 到達時
- `integrated` 完了時
- `published` 完了時
- 必要に応じて `blocked` / `failed` 時の障害解析用 snapshot

#### checkpoint の種別

checkpoint は少なくとも次の 2 種類を持つ。

- **code checkpoint**: commit / branch / tag など、Git 上のコード状態を指す参照
- **approval checkpoint**: manual acceptance や publish approval など、人の判断を示す監査参照

`accepted` 到達時は approval checkpoint を最低要件とし、**承認だけのために新規コミットを必須化しない**。コード差分がないのに approval 証跡を残す目的で空コミットを量産しないこと。

#### checkpoint に含める情報

- `checkpoint_id`
- `run_id`
- `task_id`
- `checkpoint_type`
- commit SHA または tag / branch ref / approval ref
- stage 名
- typed_ref
- base SHA
- actor / bot
- timestamp
- summary（任意）
- 関連 artifacts / retrospective ref

#### 実装方針

- Dev 終了時は task workspace の成果を branch / commit として参照可能にする
- Acceptance は approval checkpoint を必須とし、必要がある場合のみ code checkpoint を追加する
- Integrate は既存要件通り integration branch で checks 成功後、同一コミットを main へ反映する
- Publish は Git 更新ではなく外部副作用が中心であるため、必要なら release tag / release note ref を checkpoint として記録する
- blocked / failed 時の snapshot は常時自動作成ではなく、ポリシーまたは明示設定に基づいて残す

#### API / 表示要件

- `GET /v1/runs/{run_id}/checkpoints`
- `GET /v1/tasks/{task_id}/checkpoints`
- Run 詳細で各 checkpoint を一覧表示する
- 各 checkpoint から GitHub 上の commit / branch / tag または approval artifact へ遷移できるようにする

---

## 非機能要件

### 監査可能性

追加機能は既存の監査性を弱めてはならない。特に以下は必須とする。

- 可視化データは元イベントへたどれること
- retrospective は source refs を保持すること
- checkpoint は誰がどの state 境界で作成したか追えること
- summary 生成失敗時も structured metrics は失わないこと
- read model は再投影可能であること

### パフォーマンス

- Run 一覧は大量 Task でもページング可能であること
- タイムライン生成は raw event 全件スキャン前提にしないこと
- retrospective は非同期生成可能であること
- Git checkpoint 一覧取得は GitHub API の都度全件再計算にしないこと

### セキュリティ

- retrospective 生成に secrets を混入しないこと
- checkpoint 参照で機密 branch / tag を不用意に露出しないこと
- publish の副作用情報は既存 approval / RBAC 制約に従うこと

### 後方互換性

- 既存 API と state machine を壊さないこと
- 新機能は feature flag または追加 API / read model で導入すること
- 既存 Task データが checkpoint / retrospective を持たなくても動作すること

---

## 既存モジュールとの責務分担

### `agent-taskstate`

- Task / state / typed_ref / context bundle の正本
- 可視化 / retrospective / checkpoint はその上に read model を構築するだけで、正本は移さない

### `memx-resolver`

- docs resolve / chunk / ack / stale / contract の正本
- retrospective では「何を読んだか」「stale が残っていたか」を参照する
- Run 可視化では docs stale を警告表示する

### `tracker-bridge-materials`

- issue cache / entity link / sync event / context rebuild を提供
- Run 詳細では tracker / project item / external refs を関連表示する

### LiteLLM

- retrospective ナラティブ生成の標準経路
- usage / cost / routing / fallback の記録元

### RepoPolicy / BaseShaValidator / SideEffectAnalyzer

- Git checkpoint / integrate / publish 表示の基礎データとして使う
- 特に integrate / publish の表示は policy と validation の結果を含める

---

## 実装順序

`RUNBOOK.md` の完了状況を前提に、以下の順で実装する。

### Phase A. Read Model 整備

対象:

- Run 一覧 / 詳細用の read model
- timeline / audit summary API
- 既存イベントからの投影ロジック
- projection freshness / source_event_cursor の保持

受け入れ条件:

- 既存 Task から state / stage / blocked 理由 / approval 状態が読める
- retry / heartbeat / orphan / lock conflict を要約表示できる
- 同一 Task の複数 Run を区別できる

### Phase B. Git Checkpoint 記録

対象:

- stage 境界での checkpoint recording
- code checkpoint と approval checkpoint の分離
- Git 参照と Task / Run の関連付け
- Run 詳細での表示

受け入れ条件:

- integrate / publish 既存フローを壊さず checkpoint が残る
- `BaseShaValidator` / `RepoPolicy` と矛盾しない
- approval 証跡のためだけの空コミットを必須にしない

### Phase C. Retrospective 生成

対象:

- summary metrics 集約
- retrospective read model
- narrative 生成ジョブ
- partial / failed / stale の状態表現

受け入れ条件:

- 成功 Run / 失敗 Run の両方で structured summary が取得できる
- LiteLLM 失敗時も summary metrics は参照可能
- 再生成時に過去生成物との関係を追える

### Phase D. UI / Dashboard

対象:

- Run 一覧画面
- Run 詳細画面
- retrospective 表示
- checkpoint 表示

受け入れ条件:

- API だけでなく、人が追える形で確認できる
- 監査者向け情報とオペレータ向け情報を過不足なく提示できる

---

## 受け入れ基準

### Run 可視化

- 既存 Task について current state / current stage / risk / blocked 理由を一覧表示できる
- Run 詳細で state 遷移タイムラインと audit summary を確認できる
- retry / heartbeat / orphan / lock conflict / approval 状態が欠落なく表示される
- 同一 Task の複数 Run を混同しない

### レトロスペクティブ

- `integrated` / `published` / `failed` / `blocked` の各終了 Run に対し retrospective を生成できる
- duration / usage / retry / files changed / checkpoints / publish 結果を structured summary として取得できる
- narrative 生成失敗時でも summary metrics は読める
- Run 単位で保存され、再実行時に上書き事故が起きない

### Git チェックポイント

- stage 境界で commit / branch / tag / approval ref などの参照を記録できる
- Run 詳細から各 checkpoint をたどれる
- integrate の bot push と publish の approval gate を迂回しない
- approval 証跡と code snapshot を混同しない

---

## ブロッカー

次のいずれかが未解消なら、本追補の実装を開始しない。

- `RUNBOOK.md` の正本と実装状態にズレがある
- state machine / API contract / schema の差分が未解消
- Run の一意識別子と Task との対応関係が未定義
- Git checkpoint の責務が Integrate / Publish と衝突する
- retrospective 入力に secrets 混入防止の設計がない
- raw event から read model を再構築できない

---

## 推奨マイルストーン

| マイルストーン | 内容 | 優先度 |
|---|---|---|
| M1 | Run read model / timeline API | 高 |
| M2 | audit summary / blocked reason 可視化 | 高 |
| M3 | Git checkpoint recording | 高 |
| M4 | retrospective metrics 集約 | 中 |
| M5 | retrospective narrative 生成 | 中 |
| M6 | Run dashboard UI | 中 |

推奨順は `M1 -> M2 -> M3 -> M4 -> M5 -> M6` とする。まず可視化と checkpoint を整備し、その後 narrative 生成を追加することで、LLM 依存がなくても運用価値を出せるようにする。

---

## 結論

`ADD_REQUIREMENTS_2.md` に定義する追加機能は、shipyard-cp の基盤方針を変えるものではなく、既存の Control Plane を **見える化し、振り返れ、監査しやすくするための追補**である。仕様の正本はあくまで `REQUIREMENTS.md`、実装順と現状の正本は `RUNBOOK.md` とし、本書はその上に追加機能の導入境界を固定する。

今後は、まず Run 可視化の read model と API を追加し、次に checkpoint を整備し、その後 retrospective を導入する順で進める。
