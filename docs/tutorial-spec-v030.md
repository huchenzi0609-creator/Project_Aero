# 新手教程技术规格（v0.3.0 · 供 M8 实现，最后制作）

> 文案逐条脚本见 `docs/ui-copy-v030.md`（文案专员产出）。本文件定义架构、事件契约与核心层前置依赖。

## 1. 总架构

教程不重新实现游戏：在**真实单机流程**（摆阵 Placement → 对局 GameScreen）之上叠加一层教程驱动层，通过"观察游戏状态变化 → 输出气泡/突显指令"推进。

```
apps/web/src/tutorial/
  TutorialProvider.tsx   # 教程上下文：注册单元步骤机、发布气泡/遮罩指令、next()/skip()
  TutorialBubble.tsx     # 纸感对话气泡：自动随文本调整大小/位置，竖版在空网格下方、横版在参考网格下方，不遮挡空网格与突显目标
  TutorialSpotlight.tsx  # 遮罩突显：除突显对象/气泡/教程文本外画面降亮度
  steps/
    basicPlacement.ts    # 单元1 摆阵
    basicBattle.ts       # 单元2 对战
    advancedTools.ts     # 单元3 工具
```

- 单元间通过路由/状态衔接：单元1 的确认布阵点击 → 直接进入单元2（沿用玩家所摆阵型）；单元2 胜利 → 弹窗「基础教程已完成…」；单元3 弹窗「进阶教程已完成…」。
- 每个单元右上角「跳过」→ 跳过当前单元（回到该单元入口弹窗流程的下一节点）。
- 入口弹窗（教程首页）："您是否了解本游戏的基本规则？" →「是的」（直接进单元3）/「还没有」（进单元1）。

## 2. 状态机模型

- 每步 = `{ text: string | string[]; when?: GameEvent; highlight?: HighlightTarget; wait?: number; onEnter?: () => void }`。
- 推进语义（对应用户规格记号）：`\n`=等待点击推进；`<>`=条件/命令；`[]`=气泡文本。
- 事件等待：订阅游戏事件流，条件满足自动推进；纯文本步等待点击气泡推进。
- 等待类条件示例：`3 秒内是否有方格被染色` → `wait`+重查实现。

## 3. 游戏事件钩子契约（M4 在 GameScreen/Placement 接线时预留，最小侵入）

教程层订阅以下事件（通过回调注册，游戏代码只在关键点调用，不感知教程）：

| 事件 | 触发点（M4 加钩子处） | 用途 |
|---|---|---|
| `planePlaced {planeId}` | 飞机拖入网格 | 单元1 |
| `planeRotated {planeId}` | 单击旋转 | 单元1 |
| `allPlanesPlaced` | 全部入格 | 单元1 |
| `formationValid` | 阵形合法性变化为真 | 单元1 突显确认按钮 |
| `confirmPlacement` | 点击确认布阵 | 单元1→2 |
| `shotByPlayer {coord, outcome}` | 我方报点完成 | 单元2 分支文案 |
| `planeKilled {side}` | 任一飞机被击毁 | 单元2/3 |
| `playerWin / playerLose` | 胜负 | 单元2 收尾 |
| `enteredColoring` | 进入着色模式 | 单元3 |
| `cellColored {coord}` | 方格染色 | 单元3 等待重查 |
| `ghostCreated {id}` | 参考飞机拖成幽灵 | 单元3 |
| `ghostBatchColored {id, cells}` | 着色模式点击幽灵飞机 | 单元3 |
| `preFireCreated {coord}` | 创建预报点 | 单元3 |

实现方式建议：`GameScreen` 暴露 `onGameEvent?: (e: TutorialGameEvent) => void` prop；教程模式由带 TutorialProvider 的包装页传入。钩子为空函数时零开销。

## 4. 突显（Spotlight）目标

| 目标 | 定位方式 |
|---|---|
| 飞机待选栏 | 摆阵页托盘 DOM 引用（ref 注册） |
| 空网格 | 我方报点网格容器 |
| 参考网格 | 样式参考面板容器 |
| 我方网格 | 我方阵型面板容器 |
| 坐标输入框 | 输入组件 ref |
| 着色工具按钮 | 工具栏按钮 ref |
| 确认布阵按钮 | 按钮 ref |

注册方式：`TutorialProvider` 提供 `registerTarget(name, getRect)`；组件挂载时注册、卸载时注销。

## 5. 核心层前置依赖（需 M1 补，M8 开始前必须就绪）

1. **教学 AI（避开机头报点）**：单元2/单元3 的对手 AI 必须"避开我方所有机头位置进行报点"（可命中机翼/机身，但绝不报我机头格）。需要 game-core 提供一个 AI 策略选项（如 `avoidHeads: true`）或专用教学 AI；难度可复用 normal 档的其余行为。
2. **残局状态注入**：单元3 开局要求"我方阵型随机生成，已被对手击毁一架，对方先手"。需要 game-core 支持从给定阵型构造状态时：将我方某一架飞机的全部格标记为已击中/击毁（等效对手已完成击毁）、并把当前回合设为对方。建议暴露 `createGame(config, { preKillMyPlane: true, firstTurn: 'them' })` 之类的能力（实现自由，签名由 M1 定）。
3. 单元1 结束需把玩家摆的阵型直接带入单元2：现有"确认布阵→开局"流程已支持，无需新能力。

## 6. 气泡规则（实现要点）

- 定位锚：竖版在空网格下方；横版在参考网格下方；必要时允许在突显目标旁（优先级：不遮挡空网格与突显目标 > 贴近锚点）。
- 自适应：`max-width: min(90cqw, 42ch)`，高度随文本；溢出时优先向上/向下扩展。
- 点击气泡推进；有「跳过」单元的右上角按钮；气泡与遮罩均为纸感样式（沿用 stage.css 设计变量）。
- 遮罩实现：fixed 全屏半透明层 + 目标区域"开洞"（clip-path / box-shadow 方案均可，需支持圆形图标与矩形面板两类目标）。
