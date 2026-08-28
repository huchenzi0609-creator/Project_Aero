# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 仓库初始化：pnpm monorepo（apps/web、apps/server、packages/game-core、packages/shared）
- 安装 AgentTeams 插件（@nanmicoder/dsh-agent-teams ^0.1.14）至 web profile
- docs/design.md：经用户确认的修订版设计定稿
- docs/game-core-api.md：game-core 公开 API 契约
- docs/handoff-m4-m6-m7.md：M4/M6/M7 交接规格
- packages/shared：协议类型、zod schema、默认飞机形状、计时常量、游客 token 键、房码长度、gameEnd 统计契约
- M3 纸感设计系统：纸纹理/组件库/PlaneGlyph/StampMark/PaperGrid + 主页/单机菜单/自定义编辑器/设置/规则/联机菜单/对局占位页 + 横竖版响应式
- M1 规则引擎 + M2 四级 AI（75 测试）：纯函数引擎（无效打击/绝地反击/击毁仅报机头）、热图 AI（梯度 easy 131 > normal 80 > hard 58 ≈ hell 58 回合）、generateFleet 加权摆阵（26×26 单次 ~30ms）
- M4 单机完整流程：摆阵（拖拽/旋转/吸附/随机摆阵/校验清单）→ 先后手 → 双网格对战（AI 动画/绝地反击提示）→ 结算（阵型公开+统计+再来一局）
- M5 联机后端：游客身份+SQLite 落盘、房间/匹配状态机、服务端权威裁决（残骸绝不泄露）、围棋读秒制+机器接管、断线重连回放（29/29 测试通过）
- M6 联机前端：三入口（局域网房码/公网匹配/自定义房间）、事件驱动会话（回放幂等）、读秒倒计时+超时机会、机器接管/断线横幅、双浏览器集成冒烟通过
- ESLint / Prettier / CI / Playwright e2e 基建

### Changed

- 后端数据库采用 Node 内置 node:sqlite（替代 better-sqlite3，免原生编译）

## [0.1.0] - 待发布

- 首个可玩版本（计划内：单机三档 + 自定义模式 + 联机 + 四级 AI + 纸感 UI）
