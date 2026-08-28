# Project Aero — 纸面飞机海战

双人（人机/联机）回合制策略网页游戏。灵感来自传统纸面游戏"海战"，双方在网格上秘密布置飞机，轮流报点，先击毁对方全部飞机者胜。整体视觉追求柔和纸张质感，支持横/竖版响应式布局。

## 规则摘要

- 棋盘：10×10 / 15×15 / 20×20，或自定义 10~26 的 height×width 矩形；飞机数分别为 3 / 5 / 7（自定义 n ∈ [1, ⌊hw/25⌋]）。
- 默认飞机 10 格（机头 1、机翼 5、机身 1、机尾 3，左右对称）；自定义飞机在 5×5 内绘制：四邻连通、2~15 格、恰 1 机头。
- 报点反馈：无飞机→击空；非机头部件→击中；机头→击毁（**被击毁飞机不公开位置**，其后对该机残骸报点一律按"无效打击"报击空——误导对手是核心策略）。
- 特殊规则·绝地反击：先手方一次行动击毁对方全部飞机且自身恰剩 1 架时，后手获一次额外报点；仅命中机头判后手胜，否则先手胜。
- 联机计时（围棋读秒制）：每回合 20s，超时消耗 1 次全局机会（共 3 次）并重置读秒；机会耗尽后每回合 10s；此后首次超时机器接管该席位。

## 技术栈

- Monorepo：pnpm workspace + TypeScript
- `apps/web`：React 18 + Vite + Zustand（DOM+SVG 混合壳，无游戏引擎）
- `apps/server`：Node + Socket.IO + Express + `node:sqlite`（服务端权威裁决，防作弊）
- `packages/game-core`：纯 TS 规则引擎 + 四级难度 AI（零运行时依赖）
- `packages/shared`：协议类型 / zod schema / 常量

## 开发

```sh
pnpm install          # 安装依赖
pnpm dev:web          # 前端 http://localhost:5173
pnpm dev:server       # 后端 http://localhost:3001
pnpm check:ci         # lint + typecheck + test + build
```

## 运行说明

### 本地启动

```sh
pnpm install          # 首次：安装依赖
pnpm dev:server       # 后端 http://localhost:3001（联机需要；只玩单机可跳过）
pnpm dev:web          # 前端 http://localhost:5173
```

浏览器打开 http://localhost:5173 即可游玩。单机对局无需后端；进入联机页面前请先启动 `dev:server`（未启动时前端会显示"未连接"并自动重连，联机按钮禁用）。

### 联机说明

- **局域网对局**：主页 → 联机对战 → 选档位 → 创建房间，得到 6 位房码（可复制）；另一台同一局域网的设备输入房码加入。
- **公网匹配**：需将后端部署到公网可访问地址，前端以 `VITE_SERVER_URL` 指向该地址；进入匹配队列后按同档位配对，30 秒未匹配可自建房间。
- **自定义房间**：房主在联机菜单配置棋盘与飞机形状，加入者输入房码自动获得房主配置；自定义配置不进公网匹配池。
- 联机采用服务端权威裁决（双方阵型只存服务端），60 秒内断线可凭 token 重连恢复；超时由机器接管。

### e2e 测试

```sh
# 本机若无 playwright headless-shell，需指定完整 Chromium 二进制：
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing \
  pnpm e2e
```

`playwright.config.ts` 的 `webServer` 会自动拉起 vite 与 server（无需手动启动）。单机用例不依赖 server，联机用例需要双服务。全部用例通过即为验收通过。

## 目录结构

```
Aero/
├── apps/web/            # React 前端
├── apps/server/         # 联机后端
├── packages/game-core/  # 规则引擎 + AI
├── packages/shared/     # 共享类型与协议
├── docs/                # 设计文档与 API 契约
└── CHANGELOG.md         # 更新日志（Keep a Changelog）
```

## 团队协作

采用 AgentTeams 多 Agent 并行开发（队长负责对接与集成，UI/核心/后端/QA 分工）。见 `docs/design.md`。
