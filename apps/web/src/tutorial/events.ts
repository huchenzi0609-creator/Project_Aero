/**
 * 新手教程 · 游戏事件契约（v0.3.0，docs/tutorial-spec-v030.md §3）。
 *
 * M4 在 Placement / GameScreen 各触发点接线时【只发事件、不感知教程】：
 * 页面暴露可选 prop `onGameEvent?: (e: TutorialGameEvent) => void`，
 * 教程驱动层（M8 TutorialProvider 包装页）注入；为空时调用零开销。
 *
 * payload 语义约定（各字段见事件行注释，避免 M8 侧二次猜测）：
 * - planeId：摆阵页飞机 id（托盘/棋盘共用）；
 * - coord：Cell { r, c }（0-based，与全站一致）；
 * - outcome：'miss' | 'hit' | 'kill'；
 * - side：被击毁飞机所属机群属主（0=我方，1=对方）——由事件发出方按当前对局身份换算；
 * - ghost id：GameScreen 参考飞机副本（string 化数字 id，与 ColoringTool GhostRect.id 一致）。
 */
import type { Cell, PlayerId, ShotOutcome } from '@aero/shared'

export type TutorialGameEvent =
  /** 摆阵：飞机拖入网格成功（对前后机队做单架增量比对；随机/清空等批量变化不逐架补发） */
  | { type: 'planePlaced'; planeId: number }
  /** 摆阵：单击旋转飞机（同 id 旋转值发生变化的单架增量） */
  | { type: 'planeRotated'; planeId: number }
  /** 摆阵：已入格架数达到本局飞机总数 */
  | { type: 'allPlanesPlaced' }
  /** 摆阵：阵形合法性由不通过变为通过（确认按钮可用的上升沿） */
  | { type: 'formationValid' }
  /** 摆阵：点击「确认布阵」且开局成功 */
  | { type: 'confirmPlacement' }
  /** 对局：我方完成一次报点（含预报点自动上报）；outcome 为本次结果 */
  | { type: 'shotByPlayer'; coord: Cell; outcome: ShotOutcome }
  /** 对局：任一飞机被击毁（side = 被击毁机群属主 0=我方 / 1=对方） */
  | { type: 'planeKilled'; side: PlayerId }
  /** 对局终局：我方获胜 */
  | { type: 'playerWin' }
  /** 对局终局：我方落败（含超时判负） */
  | { type: 'playerLose' }
  /** 着色：进入着色模式（按钮切换或调色板选色进入） */
  | { type: 'enteredColoring' }
  /** 着色：单个方格被染色（擦除不触发；整机批量染色走 ghostBatchColored） */
  | { type: 'cellColored'; coord: Cell }
  /** 着色：参考飞机副本成功拖入对手棋盘（幽灵飞机诞生） */
  | { type: 'ghostCreated'; id: string }
  /** 着色：着色模式点击幽灵飞机完成整机批量染色（快捷着色默认开；此时幽灵被回收） */
  | { type: 'ghostBatchColored'; id: string; cells: Cell[] }
  /** 预报点：非我方回合点击空网格创建成功 */
  | { type: 'preFireCreated'; coord: Cell }
