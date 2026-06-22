# QEG fixture

このfixtureは Shipyard GLM tool_plan Run System の現在状態を `standard` profile で判定する。

期待判定は `conditional_go`。理由は、要件・Run System packet・4OSS接続は成立しているが、dry-run、diff artifact、変更制限、rework loop、artifact URI永続化が未実装の残留リスクとして残るため。

