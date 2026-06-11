---
intent_id: INT-INSTRUCTION-PRECISION-001
owner: shipyard-cp
status: active
last_reviewed_at: 2026-06-11
next_review_due: 2026-07-11
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

