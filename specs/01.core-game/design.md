# Feature 01 设计

- `PuzzleApp` 负责场景状态与运行时 UI。
- 图库元数据保留在只读定义中，用户状态用带版本的 JSON 保存。
- 规则网格以 `puzzleId + difficulty` 固定 seed 打乱。
- 结算先写完成状态与基础奖励，再请求插屏，广告失败不影响结算。
