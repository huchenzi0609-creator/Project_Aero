# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.1] - 2026-08-29

### Fixed

- 严重 bug：单人对局中央"对手棋盘"错误渲染了对方报点（aiBoard.shotsFired），现改为正确渲染我方报点（myBoard.shotsFired）——中央网格用于标记己方报点、推演对方飞机位置（联机页本无此问题）

### Changed

- 文案精简：删除主页/规则/单机菜单/设置/自定义页的多处啰嗦小字说明
- 文案修改：游戏标题"纸面海战"→"方格空袭"；"今日纸名"→"你好，"；公网匹配说明→"选择配置，匹配对手"
- 图形：机头图形移除三角形鼻尖，仅保留同心圆
- 版本号全部升至 0.1.1

## [0.1.0] - 2026-08-29

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
- M7 音效（Web Audio 程序合成，无外部音频）：铅笔沙沙（报点）/盖章（击中）/重章+纸裂（击毁）/纸张翻动（切页）/胜负小旋律 + 低频暖垫+慢速滤波噪声 BGM；首次用户交互解锁（移动端自动播放兼容）、BGM/音效独立增益、接设置双推杆、prefers-reduced-motion 时自动停 BGM
- M7 动效与无障碍：报点结果 aria-live 播报（「我方/对方报点 Xn：击空/击中/击毁」）、结算页与 Toast 播报、prefers-reduced-motion 全局禁用动画/过渡、窄屏状态栏防横向溢出
- M7 Playwright e2e 套件（6 用例全绿）：主页三入口/横竖版切换、单机小型档全流程（摆阵→横幅→对局→结算→再来一局）、自定义编辑器校验清单逐条触发、设置持久化（刷新保留）、双浏览器联机全流程+非当前回合禁点、26×26 对局页无横向溢出性能冒烟
- ESLint / Prettier / CI / Playwright e2e 基建

### Changed

- 后端数据库采用 Node 内置 node:sqlite（替代 better-sqlite3，免原生编译）

## [0.1.0] - 2026-08-29

- 首个可玩版本：单机三档 + 自定义模式 + 联机（局域网/公网匹配/自定义房间）+ 四级 AI + 纸感 UI + 程序合成音效
- 全功能现场可演示；桌面横版与手机竖版可用；联机双端画面一致；Playwright e2e 全绿
