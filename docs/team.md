# 团队章程（team.md）— 组长权威版

> 本文档是团队协作的最高依据：职责分工、文件域、git 权限、派单与验收流程。所有 agent 派单必须与本文件一致；冲突时以本文为准（由组长维护）。

## 1. Git 权限（v0.3.2 起生效）

- **一切 git 命令由组长统一执行**（status/add/commit/tag/checkout/merge 等）。
- 各开发 subagent **禁止执行任何 git 命令**：不 commit、不 add、不 checkout/reset/stash/pull/push/tag、不运行 git status 之外任何诊断（git status 只读允许，仅为自查）。
- **例外：M9（运维 agent）** 保留对以下 5 个文件的独立 git 权限（Conventional Commits、当前分支、绝不 push）：`docs/ops-handbook.md`、`docs/deploy.md`、`ecosystem.config.cjs`、`Dockerfile`、`scripts/pub-smoke.mjs`。
- subagent 交付 = 编辑文件 + 汇报改动清单与验证结果；**组长 review 后统一 commit**（commit message 按 Conventional Commits，标注来源 agent）。

## 2. 职责分工（互不重叠）

| Agent | 职责范围 |
|---|---|
| **M1+M2**（a93be706） | game-core 规则引擎与 AI、shared 类型/zod/常量；docs/game-core-api.md |
| **M3**（86f31ed7） | 纸感设计系统、主页/设置/练习模式菜单页、共享 UI 组件（components/v030 等）、ColoringTool、styles |
| **M4**（83f1ef20） | **单机对局域**：GameScreen/Placement 单机接线、gameStore 单机转发、对局域缺陷修复（含组长指派的联机/单机对局 bug） |
| **M5**（f97e26e7） | **联机服务端**：apps/server/**、docs/online-protocol-v030.md |
| **M6**（ba0005d5） | **联机前端**：OnlineMenu/OnlineGame/OnlinePlacement、apps/web/src/online/** |
| **M7**（3c87574d） | QA：apps/web/e2e/**、测试适配与全量回归、缺陷记录 |
| **M8**（c937cfa9） | **教程域**：apps/web/src/tutorial/**、pages/TutorialEntry.tsx、Home.tsx 教程入口按钮、gameStore 教程方法、教程所需 GameScreen 最小 props、styles/tutorial.css |
| **文案**（a353ed4f） | docs/ui-copy-v030.md 等文案文档（不写代码） |
| **M9**（9198286c） | 服务器部署/运维（见 §1 例外） |
| **组长** | git 全权、派单、集成验收、版本收口（package.json 版本号、CHANGELOG、README/design 同步、打 tag）、跨域裁决 |

## 1.1 版本发布清单（组长每次发版必须逐项核对）

1. 全仓 package.json 版本号一致（根 + apps/web + apps/server + packages/game-core + packages/shared）。
2. **Home 页面右下角版本角标与版本号一致**（v0.3.4 起；Home.tsx 角标归 M3 维护，发版时组长派 M3 同步或自查确认）。
3. **首页底部居中备案号「浙ICP备2026073891号」与工信部链接常驻**（v0.3.12 起，合规必查；所有版本与双通道部署都必须包含）。
4. CHANGELOG 定版（[x.y.z] - 日期）+ README/design 同步。
5. check:ci 全绿 + e2e 全绿后打 annotated tag；不 push。

**M4 与 M8 的边界（明确版）**：M4 = 对局本身的运行逻辑（GameScreen 对局流程、单机 wiring、对局 bug）；M8 = 教程驱动层（教程步骤机/气泡/遮罩/入口，以及为教程目的在 GameScreen 上增加的**最小、可选的 props/事件**）。教程文件里引用 GameScreen 的功能一律只读使用；GameScreen 内部行为变更归 M4（或组长指派的修复人），M8 只在确需时提出并在派单中经组长授权。

## 3. 文件域（互不重叠，v0.3.2 起）

- `packages/game-core/**`、`packages/shared/**`、`docs/game-core-api.md` → M1
- `apps/server/**`、`docs/online-protocol-v030.md` → M5
- `apps/web/src/pages/Home.tsx`、`Settings.tsx`、`PracticeMenu.tsx`、`CustomConfig.tsx`、`Rules.tsx`、`store/settingsStore.ts`、`components/grid/ColoringTool.tsx`、`components/v030/**`、`styles/**`（除 tutorial.css）→ M3
- `apps/web/src/pages/GameScreen.tsx`、`Placement.tsx`、`store/gameStore.ts`（对局部分）、单机 hooks → M4
- `apps/web/src/pages/OnlineMenu.tsx`、`OnlineGame.tsx`、`OnlinePlacement.tsx`、`apps/web/src/online/**` → M6
- `apps/web/src/tutorial/**`、`pages/TutorialEntry.tsx`、`styles/tutorial.css`、Home.tsx 教程入口按钮、gameStore.ts 教程方法 → M8
- `apps/web/e2e/**` → M7（QA）
- `docs/ui-copy-v030.md` → 文案 agent
- 根/各包 `package.json` 版本号、`CHANGELOG.md`、`README.md`、`docs/design.md`、`docs/tutorial-spec-v030.md`、`docs/qa-checklist-v030.md` → 组长
- 跨域改动（如 GameScreen 与教程联动）由组长在派单中显式授权，未授权禁止越界；越界需求一律上报组长裁决。

## 4. 派单与验收流程

1. 组长写派单：任务、**文件域（含是否扩域）**、验收标准、**禁止事项（git/push/tag/越界文件）**。
2. agent 只编辑授权文件，完成后汇报：改动文件清单、根因/方案、验证结果（typecheck/build/test 输出摘要）。
3. 组长 review（读 diff）→ 统一 commit → 反馈或进入 QA。
4. QA（M7）按 docs/qa-checklist 或派单断言执行 e2e，缺陷记录上报，不直接修 src。

## 5. 约定

- 分支纪律：当前开发分支（release/v0.x.y）上工作；不动 main；不 push；不打 tag（组长除外）。
- 提交信息：Conventional Commits（feat/fix/docs/chore/test/refactor/style）。
- 依赖纪律：新依赖需组长批准。
