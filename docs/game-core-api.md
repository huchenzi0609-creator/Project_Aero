# game-core 公开 API 契约

> 本文件是 `@aero/game-core` 与消费方（apps/server、apps/web、AI 模块）之间的**唯一接口契约**。
> 实现者（核心 Agent）必须严格按此签名与语义实现；消费者（后端/前端）只允许 import 这里列出的导出。

## 坐标约定

- `Cell = { r: number; c: number }`，均为 **0-based**；棋盘 (0,0) 在左上。
- 文字坐标：列=字母（A=0），行=数字（1-based）。`parseCoord("A5") → { r: 4, c: 0 }`；`formatCoord({r:4,c:0}) → "A5"`。
- 飞机形状以 5×5 编辑器坐标系描述（0..4）。`PlacedPlane.origin` 为**旋转后包围盒左上角**在棋盘中的位置。

## 导出清单（packages/game-core/src/index.ts）

```ts
export type { Cell, PlaneShape, PlacedPlane, Rotation, Shot, ShotOutcome, GridConfig, Difficulty } from '@aero/shared'

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

export interface GameState {
  phase: GamePhase
  players: [PlayerBoard, PlayerBoard]   // 0=先手, 1=后手
  turn: 0 | 1                            // 当前报点方
  firstMover: 0 | 1
  turnNo: number                         // 从 1 开始
  winner: 0 | 1 | null
}

export function createGame(width: number, height: number, shape: PlaneShape, planeCount: number, firstMover: 0 | 1): GameState
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

### applyShot 语义（必须逐条实现）

1. 仅 `playing` / `counterattack` 阶段合法。
2. `coord` 越界 → `{ ok: false, error: 'out-of-bounds' }`。
3. 该格已被当前报点方报过（在 `shotsFired` 中）→ `{ ok: false, error: 'already-shot' }`。
4. 目标方该格：
   - 无飞机，或属于**已击毁**飞机（无效打击）→ `outcome: 'miss'`；
   - 存活飞机的非机头格 → `outcome: 'hit'`；
   - 存活飞机的机头格 → `outcome: 'kill'`，该机加入 `destroyedPlaneIds`。**不产生任何残骸信息公开**。
5. 报点记录：写入射击方 `shotsFired` 与目标方 `receivedShots`。
6. 胜负与绝地反击（本步后判定）：
   - 目标方机队全灭时：
     - 射击方是先手且**射击方剩余机数恰为 1** → 进入 `counterattack` 阶段：`turn` 切换为后手（= 1 - firstMover），仅此一次额外报点，`winner` 暂为 null；
     - 否则 → `winner = 射击方`，`phase = 'ended'`。
   - 未全灭：正常轮换 `turn = 1 - turn`，`turnNo + 1`。
7. `counterattack` 阶段的报点：`outcome === 'kill'` → `winner = 射击方（后手）`；否则 `winner = firstMover`；均置 `phase = 'ended'`。

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

/** 生成合法机队（必须通过 validateFleet）。 */
export function generateFleet(
  width: number, height: number, planeCount: number,
  shape: PlaneShape, difficulty: Difficulty, rng: Rng,
): PlacedPlane[]
```

### AI 难度语义

- **easy**：未报点格中均匀随机（含"遗忘"意味，不利用任何信息）。
- **normal**：有未处理的 `hit` 时随机围杀其 4 邻格；否则均匀随机。
- **hard**：热图——枚举形状 4 旋转的全部合法摆放位，按与历史反馈的一致性加权（hit 格应被覆盖加分、kill 机头格被覆盖直接排除、**miss 格被覆盖直接排除**——修正说明：机队无重叠，存活飞机任意格被击只报 hit/kill，故 miss 格不可能属于任何存活飞机，覆盖 miss 的摆放必非存活摆放；经参数扫描实测，排除优于降权约 11.7 步），取最高分格，同分随机破平。
- **hell**：hard 热图 + 对手布阵习惯先验（边缘/角落/分散度加权）+ 残骸多解建模（由机头位置与 hit 历史推断可能残骸，降低这些格的射击价值）；允许少量随机扰动（≤5%）。
- **generateFleet**：easy/normal 均匀随机合法；hard 随机但惩罚聚集与贴边规律；hell 对抗热图的防御性摆位（大间距、角落/边缘偏好、非对称、增强残骸多解）。

性能要求：26×26 下 chooseShot 单次 < 50ms（纯枚举即可达标，无需 Worker）。
