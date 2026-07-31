# 巧拼雅集项目上下文

## 项目

- Cocos Creator 3.8.8 TypeScript 2D 竖屏小游戏。
- 发布目标只有微信小游戏与抖音小游戏；Web Mobile 用于本地验证。
- 需求基线：`docs/PRODUCT_REQUIREMENTS.md`。
- 规格与任务：`specs/`。

## 关键路径

- 主场景：`assets/scenes/main.scene`
- 游戏入口：`assets/scripts/PuzzleApp.ts`
- 平台适配：`assets/scripts/platform/PlatformAdapter.ts`
- 广告配置：`assets/scripts/platform/PlatformConfig.ts`
- 图片资源：`assets/resources/images/`

## 构建

```bash
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project . \
  --build "platform=web-mobile;debug=true;buildPath=project://build;outputName=web-mobile"
```

将 `platform` 改为 `wechatgame` 或 `bytedance` 验证两端构建。Cocos Creator CLI 在 macOS
构建成功时可能返回 36，需结合日志中的 `build finished` 和产物判断。

## 开发约束

- 平台 API 不得直接散落在业务代码中，统一通过 `PlatformAdapter`。
- 拼图操作页不展示小广告；广告失败不得阻塞关卡或基础奖励。
- 本地存储数据解析必须容错，旧版本数据不可导致启动失败。
- 每次功能修改后至少验证 TypeScript/Cocos 构建；功能完成后更新对应 `tasks.md`。
