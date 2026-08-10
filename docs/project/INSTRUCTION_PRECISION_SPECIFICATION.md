---
intent_id: INT-INSTRUCTION-PRECISION-001
owner: shipyard-cp
status: active
last_reviewed_at: 2026-08-10
next_review_due: 2026-09-10
---

# Worker指示精度 仕様書

## 概要

本仕様は、`InstructionEnvelopeV2`を生成するだけでなく、`WorkerJob`から全worker実行経路へ
同一意味で伝達するための内部契約を定義する。

## 契約

### WorkerJob

```ts
interface WorkerJob {
  input_prompt: string;
  instruction_envelope?: InstructionEnvelopeV2;
  context?: WorkerJobContext;
  metadata?: Record<string, string | number | boolean | null>;
}
```

- `instruction_envelope`は後方互換な任意フィールドである。
- `input_prompt`は削除せず、legacy jobの正本またはEnvelope jobのfallbackとして維持する。
- `context.instruction_envelope_ref`は監査・追跡用の参照であり、Envelope本体の代替ではない。

### 指示解決の優先順位

workerへ渡すpromptは次の順で決定する。

1. `instruction_envelope`が存在する: 共通rendererでEnvelopeをレンダリングする。
2. versionが`2.0`で本体がない: エラーとして拒否する。
3. `input_prompt`が存在する: 文字列を変更せず返す。
4. contextが存在する: context、repo、requested outputsからfallback promptを生成する。
5. 上記を満たさない: job validationで拒否する。

### Envelopeレンダリング

共通rendererは、次のセクションを順序固定で出力する。

1. protocol version、job ID、task ID、stage
2. authority: tier昇順
3. objective
4. must
5. must_not
6. allowed_toolsと各args schema
7. required_output kindとJSON Schema

空の`must`、`must_not`、`allowed_tools`も省略せず`None`として明示する。

### Dispatch

`DispatchOrchestrator`は次を満たす。

- `Task.objective`をEnvelopeのobjectiveへ格納する。
- `input_prompt`にもobjectiveを含め、fallback時の意味欠落を防ぐ。
- Envelope本体を`WorkerJob.instruction_envelope`へ格納する。
- `context.instruction_envelope_ref`と`metadata.instruction_envelope_version`を保持する。

## 実行経路

共通rendererを使用する対象:

- simulation adapters: Codex / Claude Code / Google Antigravity
- model gateway adapter: GLM5
- CLI executors: Claude Code / OpenCode
- OpenCode serve/session executor

各経路が独自にEnvelopeを再構築、要約、部分抽出してはならない。
GLM5のsystem promptはstage固有のJSON-only補助制約を追加してよいが、
user promptのEnvelope内容を置換してはならない。

### tool_plan 実行

GLM5 dev stage が valid `tool_plan` を返した場合、Control Plane は安全に解決できる
workspace 内でのみ、対応する local executor を実行してよい。
Run-system内の安全要件は [GLM_TOOL_PLAN_RUN_REQUIREMENTS.md](./GLM_TOOL_PLAN_RUN_REQUIREMENTS.md) を正本とし、本節は最小実行契約を定義する。

実行条件:

- `approval_policy.mode` が `deny` ではない。
- `approval_policy.sandbox_profile` が `workspace_write` または `full_auto` である。
- workspace root が `workspace_ref.kind == "host_path"` の絶対パス、または
  `repo_ref.owner == "local"` の兄弟repoとして解決できる。
- `write_file` と `apply_patch_intent` の `path` はrepo相対のみ許可し、
  絶対パスと `..` によるworkspace外参照を拒否する。

`apply_patch_intent` は `locator` が対象ファイル内に完全一致する場合だけ置換する。
一致数が0または2以上の場合は失敗扱いとする。曖昧な関数名・説明文・大きな擬似patchを推測適用してはならない。

`tool_plan` 実行は dry-run mode、diff artifact生成、最大変更ファイル数・最大書き込みサイズ制限、allowed path prefix、test failure summarizer、rework loop、artifact URIの実体保存、execution verdict、shipyard自身のacceptance gate を段階的に満たす。

実行に失敗した場合、dev result は `tool_plan_execution_failed` として失敗扱いにする。
実行がskipされた場合は、artifactとして `tool_plan` を保存するが、workspace編集済みとは扱わない。

## 成功フロー

```text
Task + DispatchRequest
  -> InstructionCompiler
  -> InstructionEnvelopeV2
  -> WorkerJob.instruction_envelope
  -> resolveWorkerPrompt
  -> worker adapter / executor
```

## 失敗時挙動

| 条件 | 挙動 | 再試行 |
| --- | --- | --- |
| version `2.0`、本体なし | worker実行前に拒否 | Envelope再生成後のみ可 |
| Envelopeあり、renderer失敗 | job失敗として返す | 原因修正後のみ可 |
| legacy promptあり | promptをそのまま使用 | 従来方針に従う |
| promptもcontextもなし | validationで拒否 | 入力補完後のみ可 |

欠落Envelopeを`input_prompt`へ暗黙フォールバックしてはならない。

## 後方互換

- `WorkerJob.input_prompt`を必須契約として維持する。
- Envelopeなしの既存jobのprompt文字列を変更しない。
- Public APIのworker type、stage、state transitionを変更しない。
- `instruction_envelope`を理解しない外部consumerは任意フィールドとして無視できる。

## 受入観点

1. dispatch jobがEnvelope本体とrefを保持する。
2. 全worker経路が共通rendererを使用し、version付き欠落jobを拒否する。
3. legacy promptの完全保持、型チェック、対象回帰、ビルドが成功する。

## 検証コマンド

```powershell
pnpm run check
npx vitest run test/instruction-renderer.test.ts test/dispatch-orchestrator.test.ts test/glm5-adapter.test.ts
pnpm run build
```

