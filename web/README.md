# shipyard-cp Web UI

日本語版 | [English](./README_en.md)

`web/` は shipyard-cp の補助UIです。  
このリポジトリの本体は backend / worker / CLI であり、frontend は task / run の可視化と補助操作を担います。

## 位置づけ

- 主導線: backend / worker / CLI
- 補助導線: Web UI
- 契約の正本: root 側の API / OpenAPI / schema

Web UI を単体プロダクトとして扱うのではなく、control plane の状態確認と軽い操作のための companion UI と考えてください。

## できること

- task 一覧 / 詳細
- run 一覧 / 詳細
- timeline / audit summary の閲覧
- 補助的な dispatch / acceptance 完了 / settings 操作
- WebSocket 接続状態の確認

## 使い方

```bash
npm install
npm run dev
```

通常は root の backend と一緒に立ち上げます。  
全体の入口は [../docs/cli-usage.md](../docs/cli-usage.md) を参照してください。

## 開発メモ

- React + TypeScript + Vite
- Tailwind CSS
- React Router
- TanStack Query

## 関連ドキュメント

- [CLI Usage](../docs/cli-usage.md)
- [Frontend Runbook](./FRONTEND_RUNBOOK.md)
- [Frontend Spec](./FRONTEND_SPEC.md)
