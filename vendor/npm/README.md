# Vendored npm artifacts

このディレクトリは、公開registryから取得できない検証済みnpm artifactをclean checkoutとCIへ供給する。

## `@rna4219/agent-protocols@2.0.0-beta.1`

- Artifact: `rna4219-agent-protocols-2.0.0-beta.1.tgz`
- Source repository: `../agent-protocols`
- Source commit: `c3d64bc`
- Package SHA-1: `e2356a5a9fe782c4520f6040208ecc263807b8b0`
- SHA-256: `4A60990226EBBD379E8DA5D2FAB767C475920365481EA323C4CB0BEA10ED982E`
- npm integrity: `sha512-gqAfF5xsMvClLNI1cT5ksKGUKZ41UbgGu/vB357v5q/bwxCsao2SXq+jTCagBcPdxn9oIyOzpwMIQ09N1Yq/eg==`

更新時はsource repositoryがcleanでversionとcommitが意図どおりであることを確認し、
`npm run release:validate`を通してから`npm pack --pack-destination ../shipyard-cp/vendor/npm`で再生成する。
artifactのhash、`package.json`、`pnpm-lock.yaml`、この記録を同じ変更で更新する。

registry packageへの移行や公開はrelease承認を別途必要とする。
