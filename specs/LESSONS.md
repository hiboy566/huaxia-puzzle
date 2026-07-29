# Lessons

## 2026-07-28 — 商业化与双平台 / Cocos CLI

Codex 运行环境设置了 `ELECTRON_RUN_AS_NODE=1`，直接执行 CocosCreator 会被当成 Node。
构建命令必须用 `env -u ELECTRON_RUN_AS_NODE`；Cocos Creator 3.8.8 成功构建在 macOS
返回 36，应以日志中的 `build Task (...) Finished` 与产物入口文件共同判定。

## 2026-07-28 — 留存与辅助 / 异步预览

延时预览必须捕获当前 Sprite 引用并在回调后检查有效性，避免用户切换关卡后旧计时器修改
新画面。结算前应冻结用时，避免插屏加载等待被计入成绩。
