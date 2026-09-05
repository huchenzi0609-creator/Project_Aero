# game-core 公开 API 契约

> 本文件是 `@aero/game-core` 与消费方（apps/server、apps/web、AI 模块）之间的**唯一接口契约**。
> 实现者（核心 Agent）必须严格按此签名与语义实现；消费者（后端/前端）只允许 import 这里列出的导出。

## 坐标约定

- `Cell = { r: number; c: number }`，均为 **0-based**；棋盘 (0,0) 在左上。
- 文字坐标：列=字母（A=0），行=数字（1-based）。`parseCoord("A5") → { r: 4, c: 0 }`；`formatCoord({r:4,c:0}) → "A5"`。
- 飞机形状以 5×5 编辑器坐标系描述（0..4）。`PlacedPlane.origin` 为**旋转后包围盒左上角**在棋盘中的位置。

## 导出清单（packages/game-core/src/index.ts）

```ts
export type { Cell, PlaneShape, PlacedPlane, Rotation, Shot, ShotOutcome, GridConfig, Difficulty, PlayerId, TutorialAiOptions } from '@aero/shared'
```

> 模式开关（shared `GridConfig`，均可选、缺省 false、互不冲突）：`blitz`（超快棋）、`blind`（盲棋）；
> 经典 = 两者皆否，自定义可任意组合。旧配置（无这两字段）向后兼容。
> 常量（shared）：`BLITZ_SECONDS_PER_PLANE = 10`、`BLITZ_BONUS_MS = 1000`、`BLIND_VISIBLE_RECENT = 3`、`PRE_FIRE_LIMIT = 10`。

```ts
export const SHAPE_SIZE = 5

/** 规范化：去重 cells、校验 head 在 cells 内（非法返回原样 + 由 validateShape 判定） */
export function normalizeShape(shape: PlaneShape): PlaneShape

/** 形状校验：cells 均在 5×5 内且无重复；四邻连通；2..15 格；恰 1 机头。返回错误列表（中文文案） */
export function validateShape(shape: PlaneShape): { ok: true } | { ok: false; errors: string[] }

/** 顺时针旋转 times 次（0..3），在 5×5 内旋转（(r,c) -> (c, 4-r)） */
export function rotateShape(shape: PlaneShape, times: Rotation): PlaneShape

/** 旋转后包围盒尺寸 */
export function boundingBox(shape: PlaneShape, rotation: Rotation): { w: number; h: number }

/** 摆放后占据的绝对格位（旋转 + origin 平移） */
export function occupiedCells(plane: PlacedPlane, shape: PlaneShape): Cell[]

export function inBounds(coord: Cell, width: number, height: number): boolean

/** "A5" -> Cell；大小写/首尾空格容错；非法返回 null */
export function parseCoord(input: string): Cell | null
export function formatCoord(coord: Cell): string

/** 摆阵校验：数量 === planeCount；全部在界内；任意两机无重叠。返回错误列表（中文文案） */
export function validateFleet(
  width: number, height: number, planeCount: number,
  shape: PlaneShape, planes: PlacedPlane[],
): { ok: true } | { ok: false; errors: string[] }
```

## 对局引擎（同文件导出）

```ts
export interface PlayerBoard {
  width: number; height: number; shape: PlaneShape
  planes: PlacedPlane[]            // 本机机队（保密数据）
  destroyedPlaneIds: number[]      // 已被击毁的飞机 id
  receivedShots: Shot[]            // 对方打我方的报点记录
  shotsFired: Shot[]               // 我方打对方的报点记录（用于禁重复报点）
}

export type GamePhase = 'placing' | 'playing' | 'counterattack' | 'ended'

export interface GameModeFlags { blitz: boolean; blind: boolean }        // 模式开关（v0.3.0 起）
export interface GameOptions { blitz?: boolean; blind?: boolean }         // createGame 选项
export interface BlitzClock { clocks: [number, number] }                 // 毫秒/方（0=先手 1=后手）

export interface GameState {
  phase: GamePhase
  players: [PlayerBoard, PlayerBoard]   // 0=先手, 1=后手
  turn: 0 | 1                            // 当前报点方
  firstMover: 0 | 1
  turnNo: number                         // 从 1 开始
  winner: 0 | 1 | null
  mode?: GameModeFlags                   // 缺失视为经典模式
  blitz?: BlitzClock                     // 仅 blitz 局存在（初始 10×planeCount 秒/方）
  preFire?: Record<PlayerId, Cell[]>     // 每方预报点队列（上限 10，FIFO）；缺失视为空
}

export function createGame(
  width: number, height: number, shape: PlaneShape, planeCount: number, firstMover: 0 | 1,
  options?: GameOptions,                 // v0.3.0：缺省经典；blitz 时初始化 clocks=10×planeCount×1000ms
): GameState
export function setFleet(state: GameState, player: 0 | 1, planes: PlacedPlane[]): { ok: true; state: GameState } | { ok: false; errors: string[] }
export function isGameOver(state: GameState): boolean
export function remainingPlanes(board: PlayerBoard): number

export interface ShotResult {
  ok: boolean
  error?: string          // 'invalid-phase' | 'out-of-bounds' | 'already-shot'
  outcome?: ShotOutcome
  killedPlaneId?: number  // outcome==='kill' 时给出（仅机头信息，不公开残骸）
  state?: GameState
  winner?: 0 | 1 | null   // 本步之后若产生胜者
}

export function applyShot(state: GameState, coord: Cell): ShotResult

/** 双方平均击杀效率（v0.2.9 起）：对每位玩家，统计其击毁的每架敌机
 *  "从首次命中到击毁"的报点步数（该玩家 shotsFired 中 kill 枪下标 − 首次命中该机下标，
 *  直接爆头 = 0 步）并取平均、四舍五入 1 位小数；无击毁时对应项为 null。纯函数。 */
export function killEfficiencyStats(state: GameState): { player0: number | null; player1: number | null }
```

### 模式 API（v0.3.0 起）

```ts
/** 超快棋时钟推进：递减 player 时钟 deltaMs；扣至 ≤0 → 该玩家超时判负
 * （phase='ended'、winner=对方、时钟归零）。仅 blitz 局可调用（否则抛错）。
 * 返回带新 state（引擎纯函数，调用方需应用；任务原签名未含 state，见交付说明）。 */
export function advanceBlitzClock(state: GameState, player: PlayerId, deltaMs: number): {
  state: GameState; timedOut: boolean; winner?: PlayerId
}

/** 各玩家在"对手网格"上应显示的标记（本人射击结果；纯函数，供 UI 渲染） */
export function visibleMarks(state: GameState): { player0: Shot[]; player1: Shot[] }

/** 预报点入队：校验该格已有可见标记（按 visibleMarks 对该玩家的规则）或已在该玩家预报点中
 *  → 'CELL_TAKEN'；队列满（≥10）→ 'PRE_FIRE_FULL'；成功返回新 state。 */
export function queuePreFire(state: GameState, player: PlayerId, coord: Cell):
  { ok: true; state: GameState } | { ok: false; error: 'CELL_TAKEN' | 'PRE_FIRE_FULL' }

/** 预报点出队（取消）：移除该坐标；不存在时返回原 state */
export function cancelPreFire(state: GameState, player: PlayerId, coord: Cell): GameState

/** 预报点回合执行：轮到 player 时调用（需 state.turn === player）；队列非空 → 取队首（FIFO）
 *  执行一次正常报点并返回其 ShotResult（每回合只上报一个）；队列空 → null（正常回合）。 */
export function takePreFireTurn(state: GameState, player: PlayerId): ShotResult | null
```

### 教程（M8）能力（v0.3.0 起）

```ts
/** 残局注入：将 victim 方第 planeIndex 架整机标记为已被对手击毁——该机 id 加入
 *  destroyedPlaneIds（此后对其任意残骸格报点返回 miss，无效打击），其全部占位格补记
 *  receivedShots（非头格 'hit'、头格 'kill'；已记录坐标不重复）。**不写入对手 shotsFired**
 *  （保持其射击历史干净，残骸格后续可再报且按 miss 裁决）。幂等；应在对局开始前调用。 */
export function markPlaneDestroyed(state: GameState, victim: PlayerId, planeIndex: number): GameState

/** 设定当前行动方：覆盖 state.turn = player（残局注入用，如把首回合交给对方）。
 *  不改 firstMover/phase/winner；需首回合语义一致时在 createGame 指定 firstMover。 */
export function setActiveTurn(state: GameState, player: PlayerId): GameState

/** 残局开局种子：'me'=玩家 0、'them'=玩家 1 */
export interface EndgameSeed {
  preKill: { side: 'me' | 'them'; planeIndex: number }
  firstTurn: 'me' | 'them'
}

/** 残局开局工厂（教程单元3）：双方摆阵就绪 + 指定一架整机已被击毁 + 设定当前行动方
 *  （等价 createGame → 双方 setFleet → markPlaneDestroyed → setActiveTurn）。
 *  摆阵非法或 planeIndex 越界 → { ok: false, errors }。 */
export function createEndgameState(
  width: number, height: number, shape: PlaneShape, planeCount: number,
  myPlanes: PlacedPlane[], opponentPlanes: PlacedPlane[], seed: EndgameSeed,
): { ok: true; state: GameState } | { ok: false; errors: string[] }
```

> 教学 AI（教程单元2/3 对手，spec 见 docs/tutorial-spec-v030.md §5）在 AI 模块：
> `chooseTutorialShot(knowledge, options, rng)`，选项类型 `TutorialAiOptions { avoidHeads: Cell[] }`
> 由 shared 导出并在此 re-export——报点绝不落在 `avoidHeads`（我方机头位置）上，可命中机翼/机身/击空，
> 其余行为复用 normal 档（hit 围杀邻格 / 均匀随机），不越界不重复。

### applyShot 语义（必须逐条实现）

1. 仅 `playing` / `counterattack` 阶段合法。
2. `coord` 越界 → `{ ok: false, error: 'out-of-bounds' }`。
3. 经典模式（`mode.blind === false`）：该格已被当前报点方报过（在 `shotsFired` 中）→ `{ ok: false, error: 'already-shot' }`；
   **盲棋（`blind === true`）允许对已报点格再次报点**（含残骸格，仍按 miss 处理），跳过本拦截。
4. 目标方该格：
   - 无飞机，或属于**已击毁**飞机（无效打击）→ `outcome: 'miss'`；
   - 存活飞机的非机头格 → `outcome: 'hit'`；
   - 存活飞机的机头格 → `outcome: 'kill'`，该机加入 `destroyedPlaneIds`。**不产生任何残骸信息公开**。
5. 报点记录：写入射击方 `shotsFired` 与目标方 `receivedShots`。
6. 超快棋（`mode.blitz === true`）：射击方每次成功报点 → 该方时钟 +1000ms（记录于 `state.blitz.clocks`）。
7. 胜负与绝地反击（本步后判定）：
   - 目标方机队全灭时：
     - 射击方是先手且**射击方剩余机数恰为 1** → 进入 `counterattack` 阶段：`turn` 切换为后手（= 1 - firstMover），仅此一次额外报点，`winner` 暂为 null；
     - 否则 → `winner = 射击方`，`phase = 'ended'`。
   - 未全灭：正常轮换 `turn = 1 - turn`，`turnNo + 1`。
8. `counterattack` 阶段的报点：`outcome === 'kill'` → `winner = 射击方（后手）`；否则 `winner = firstMover`；均置 `phase = 'ended'`。

### 模式语义补充（v0.3.0）

- **超快棋（blitz）**：初始限时 `10 × planeCount` 秒/方（`createGame` 初始化）；己方成功报点 +1 秒（applyShot 内自动）；`advanceBlitzClock` 供 UI/服务器各自按实际流逝推进时钟，超时即终局（reason `'blitz-timeout'`，shared `GameEndPayload.reason` 已扩展）。blitz 局忽略 byo-yomi（turnLimitMs/超时次数/机器代打均不适用，由消费方判定）。
- **盲棋（blind）**：`visibleMarks` 对每方射击历史只保留最近 3 个非击毁标记 + 全部击毁标记（击毁不计入 3 个名额、永不消失，FIFO 淘汰）；经典模式返回全部标记。"禁用参考飞机拖放 / 着色工具"由 web 层按 config.blind 执行，core 不处理。
- **预报点**（所有模式通用，替代"对方回合禁报点"）：非己方回合的报点先进 `preFire` 队列（上限 10），轮到自己时由 `takePreFireTurn` 按 FIFO 每回合自动上报一个。

## AI 模块（packages/game-core/src/ai/index.ts）

```ts
export type Rng = () => number
export function mulberry32(seed: number): Rng

/** 射击方的全部知识：棋盘尺寸 + 历次报点结果（绝不包含对方阵型） */
export interface ShotKnowledge {
  width: number
  height: number
  shots: Shot[]       // { coord, outcome }，outcome 'kill' 的 coord 即机头位置
  planeShape: PlaneShape  // 本局飞机形状（用于热图）
}

/** 返回下一个报点坐标。硬性约束：不得越界、不得重复、只使用 knowledge。 */
export function chooseShot(knowledge: ShotKnowledge, difficulty: Difficulty, rng: Rng): Cell

/** 教程教学 AI（M8）：normal 基底 + 报点绝不落在 options.avoidHeads（我方机头）上。
 *  选项类型 TutorialAiOptions 由 shared 导出。其余约束同 chooseShot。 */
export function chooseTutorialShot(knowledge: ShotKnowledge, options: TutorialAiOptions, rng: Rng): Cell

/** 生成合法机队（必须通过 validateFleet）。 */
export function generateFleet(
  width: number, height: number, planeCount: number,
  shape: PlaneShape, difficulty: Difficulty, rng: Rng,
): PlacedPlane[]
```

### AI 难度语义（chooseShot 依 v0.2.7，generateFleet 依 v0.2.0）

- **easy**：未报点格中均匀随机（不利用任何反馈信息）。
- **normal**：有未处理的 `hit` 时随机围杀其 4 邻格；否则均匀随机。
- **hard**（v0.2.7 起 = 原地狱算法）：覆盖密度热图——枚举形状 4 旋转全部合法摆放位按反馈一致性加权（hit 覆盖加分、kill 机头格/miss 格被覆盖直接排除——miss 格必不属于存活飞机，排除优于降权实测约 11.7 步），同分随机破平；叠加残骸多解建模（推断可能残骸格降权、剪除其 hit 的围杀候选）与边缘/角落习惯先验；允许 ≤5% 随机扰动。
- **hell**（v0.2.7 起）：**机头概率热图（head-hunting）**——把候选摆放权重只累加到该摆放的**机头格**（每格 ≈ "某存活飞机机头在此"的后验）；覆盖 k 个 hit 权重 ×(1+5)^k（已命中飞机机头被约束到与 hit 兼容摆放的头部集合）；kill/miss 覆盖排除、残骸多解降权、习惯先验叠加；每次报点射向局部最可能的机头格（减少无效报点、直接爆头占比高），允许 ≤5% 随机扰动。
- **generateFleet**：easy/normal 均匀随机合法；hard/hell 为「局部密铺 + 整体分散」簇算法（簇容量随机 1~3/2~3，簇内贴邻、簇首分散至 top-~2.5% 远离已有簇质心且带边缘/角落偏好的位置，hell 强度更高）；对任意形状通用，产物保证通过 validateFleet。

性能要求：26×26 下 chooseShot 单次 < 50ms（纯枚举即可达标，实测 ≤2ms，无需 Worker）。
