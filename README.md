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
