# Feature 03 设计

- `PlatformAdapter` 统一微信 `wx`、抖音 `tt` 和 Web 模拟环境。
- 广告策略状态保存在适配器内：请求时间、失败次数、熔断截止时间和插屏时间。
- 广告错误按产品要求返回 `fallbackGranted`，业务层统一发放一次奖励并上报。
- 正式广告位只通过 `PlatformConfig` 注入，不写入业务逻辑。
