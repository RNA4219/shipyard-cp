---
name: run
description: Create a task and dispatch it with the shipyard CLI
user_invocable: true
---

# Run

```bash
shipyard run "<objective>" --repo <owner/name> [--worker codex|claude_code|google_antigravity|glm_5] [--stage plan|dev|acceptance]
```

認証は `SHIPYARD_API_KEY`、接続先は `SHIPYARD_API_URL` で設定します。
`--typed-ref` 未指定時はcanonical local typed_refを自動生成します。機械処理では `--json` を使います。
