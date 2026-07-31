# 巧拼雅集（Cocos Creator 3.8.8）

根据需求文档实现的微信小游戏 / 抖音小游戏双端拼图 MVP。工程内置竹林熊猫、晨曦长城、天安门晨光三张原创风格主题图。

## 已实现

- 首页精选图库、上次进度继续、难度选择
- 12 / 24 / 48 / 80 片四档难度
- 真实拼图凸榫/凹槽轮廓、互补接缝与立体高光描边
- 拖拽、吸附、计时、收藏/完成状态、15 秒自动存档与后台恢复
- 北京时间每日拼图、每日印章、最近难度记忆
- 首次免费提示，后续激励视频提示（每局上限与 60 秒间隔）
- 每日免费原图预览，超额激励长预览、完成分享、重玩与下一幅
- 音效、震动、减少动画、高对比、隐私与反馈入口
- 首页与结算页广告位；拼图操作页不展示横幅广告
- 插屏新手保护与间隔控制、激励广告失败兜底与 10 分钟熔断
- 微信 `wx`、抖音 `tt`、网页预览三套运行适配
- 横屏响应式布局：适配 4:3、16:9、18:9、19.5:9 等比例，并避让刘海、圆角与底部手势安全区

## 本机打开

1. 启动 Cocos Creator 3.8.8。
2. 选择“导入项目”，目录选择本工程 `puzzle`。
3. 打开 `assets/scenes/main.scene`，点击预览即可。

当前命令行预览服务：<http://127.0.0.1:4173/>

## 广告上线配置

编辑 `assets/scripts/platform/PlatformConfig.ts`：

- 微信小游戏：填写 `wechat.rewardedVideoAdUnitId`、`wechat.interstitialAdUnitId`、`wechat.bannerAdUnitId`
- 抖音小游戏：填写 `douyin.rewardedVideoAdUnitId`、`douyin.interstitialAdUnitId`、`douyin.bannerAdUnitId`
- 联调阶段可保留 `simulateWhenUnconfigured: true`；提审前建议改为 `false`

广告位 ID 需要分别在微信公众平台和抖音开放平台创建，不能跨平台复用。当前空 ID 会走安全降级：网页或未配置时模拟激励成功，不阻断核心拼图流程。Banner 使用平台原生广告覆盖层，首页/结算页显示、拼图操作页自动隐藏。

## 构建

在 Cocos Creator 的“项目 → 构建发布”中分别选择：

- `wechatgame`：微信小游戏
- `bytedance-mini-game`：抖音小游戏

两个平台均需将“屏幕方向”设为 `landscape`。命令行构建可直接使用 `build-configs/wechatgame-landscape.json` 和 `build-configs/bytedance-landscape.json`，避免构建时恢复为竖屏。

首次发布前还需在各平台后台配置 AppID、合法域名、隐私协议、广告位及分享素材。

已验证构建产物：

- `build/web-mobile`
- `build/wechatgame`
- `build/bytedance-mini-game`

## 关键目录

```text
assets/
├── resources/images/       # 拼图主题图
├── scenes/main.scene       # 启动场景
└── scripts/
    ├── PuzzleApp.ts        # 页面、拼图和存档主逻辑
    └── platform/           # 微信/抖音广告及分享适配
```
