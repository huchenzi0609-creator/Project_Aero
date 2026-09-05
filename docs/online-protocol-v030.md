# Project Aero v0.3.0 联机协议（online-protocol-v030）

> 本文件是 **M5 联机服务端 ↔ M6 联机前端** 在 v0.3.0 的协议对齐文档。
> 说明：`packages/shared`（M1）正在把下列字段/事件并入正式类型，落地前服务端
> 已按本文件所述实现，事件经 Socket.IO 字符串通道收发。若 shared 落地后与本文件
> 有出入，以 shared 为准并在本文件注明。

## 0. 模式开关（房间配置）

`GridConfig` 新增两个可选布尔（缺省均视为 false）：

| 字段 | 含义 |
|---|---|
| `blitz?: boolean` | 超快棋：服务端权威时钟（见 §2），忽略 byo-yomi（turnLimitMs/机会/超时代打/机器接管不生效） |
| `blind?: boolean` | 盲棋：取消重复报点拒绝（见 §3） |

经典（无开关）/ 超快棋 / 盲棋 / 自定义组合均由这两个布尔表达。
服务端校验：必须是布尔（字符串等非法值 → `createRoom` ack 报「棋盘配置非法」）。
`roomUpdate` / `room:joined` 的 `config` 原样携带这两个开关，供客户端进入房间后读取模式。

## 1. 房间建立与加入（既有 + 扩展）

- **自定义房间**：沿用 `createRoom { config }`（config 可含 `blitz`/`blind`/`turnLimitMs`）；
  `joinRoom { code }` 不变。
- **快速匹配（对战模式 · 开始匹配）** —— 新增事件：

  **client → server**
  - `match:quick`：`{ combos: Array<{ gridSize: number; planes: number; blitz: boolean; blind: boolean }> }`，
    可选 ack `{ ok, error? }`（即时校验：未认证 / 缺少或非法选项 / 对局中；**配对结果不进 ack**，
    一律经下方事件通知）。
    - `gridSize ∈ {10,15,20}`；`planes ∈ [1, ⌊gridSize²/25⌋]`（标准三档即 10×3 / 15×5 / 20×7）；
      飞机形状用默认飞机（DEFAULT_PLANE_SHAPE）。
    - 请求需已认证（auth 后）；若用户残留 waiting/placing 房间会被自动释放，对局中拒绝。
  - `match:cancel`：取消本次等待（移出等待池）。

  **server → client**
  - `match:waiting`：入池成功，等待配对（无参数）。
  - `room:joined`：`{ roomCode: string, config: GridConfig }` —— 配对成功，直接进入该房间（placing）。

  配对规则：新请求与等待池中**任一**玩家的勾选组合存在**交集** → 取交集中的一个 combo
  生成配置建房（房主 = 先到者，坐 0 号位）→ 双方各收 `room:joined`；无交集 → 入池收
  `match:waiting`。断开连接自动移出池。

  进入房间后沿用既有流程：`roomUpdate` → `placeFleet` → `ready` → `phaseChange('playing')`。

## 2. 超快棋（blitz）计时 —— 服务端权威

- 初始时钟：每方 `10s × 飞机架数`（如 10×10 三机 = 30s）。
- 时钟推进：服务端 ~250ms 定时器扣减**当前回合方**剩余；玩家每次**成功报点**（shoot ack
  ok，含 miss/hit/kill）给自己 **+1s**（立即生效并广播）。
- 广播：`clock:update { player: 'me' | 'them', ms: number }`——对每个接收者各发两条
  （`'me'` 是自己剩余、`'them'` 是对方剩余；`ms` 为剩余毫秒精确值，客户端自行取整显示；
  服务端秒级节流，开局/报点奖励/回合切换会立即补发）。
- 超时（某方剩余归零）：广播
  `gameOver { winner: 0|1, reason: 'blitz-timeout', layouts: {player0, player1}, stats }`
  —— 这是 blitz 房间时钟判负的**专用终局事件**（普通对局终局仍走 `gameEnd`）。随后房间
  清理计时器并保留一小段时间供重连回放（重连时按 `endKind` 回放 `gameOver`）。
- blitz 房间**忽略 byo-yomi**：不设 turnStart 的 deadline 计时（deadline=0）、无机会消耗、
  无系统代走、无机器接管；`timerUpdate`/`turnStart.chancesLeft` 无业务意义（客户端 UI 应
  只依赖 `clock:update`）。
- 断线重连：blitz 时钟在 playing 期间持续走（不因断线暂停）；重连后服务端立即补发一次
  双方 `clock:update`。断线宽限判负（`gameEnd reason:'disconnect'`）与 blitz 时钟判负
  谁先到按谁结算。

## 3. 盲棋（blind）

- 取消「重复报点拒绝」：对已报过的格（含残骸格）**再次报点合法**，按当前棋盘旁路裁决：
  空格/已击毁飞机残骸格 → `miss`；存活飞机非机头部件 → `hit`。该步算一次正常行动（正常
  轮换回合、blitz 房照常 +1s），但**不重复触发胜负判定、不改动对局内部报点历史**。
- 广播仍是一次 `shotResult { by, coord, outcome }`；标记显示规则由**客户端按历史过滤**
  （同格重复记录由客户端 UI 决定如何呈现），协议无需变化。
- 非盲棋房间：重复报点仍被拒（ack `already-shot`），行为与 v0.2 一致。

## 4. 预报点（预排队列）

- **服务端零改动**：预报点队列完全在客户端。轮到己方时，客户端按 FIFO 每回合自动发送
  一个普通 `shoot`（本回合一个），服务端照常裁决/广播。

## 5. 事件清单汇总（v0.3.0 新增部分）

| 方向 | 事件 | payload | 说明 |
|---|---|---|---|
| C→S | `match:quick` | `{ combos }` | 进入快速匹配等待池 |
| C→S | `match:cancel` | — | 取消等待 |
| S→C | `match:waiting` | — | 已入池 |
| S→C | `room:joined` | `{ roomCode, config }` | 配对成功进房 |
| S→C | `clock:update` | `{ player: 'me'|'them', ms }` | blitz 时钟（每个接收者两条：me/them） |
| S→C | `gameOver` | `{ winner, reason:'blitz-timeout', layouts, stats }` | blitz 时钟判负专用终局 |

复用不变：`identity / roomUpdate / phaseChange / turnStart / shotResult / timerUpdate /
machineTakeover / opponentDisconnected / opponentReconnected / gameEnd`（既有 shared 协议）。

## 6. 服务端测试注入口

`RoomManagerOptions.blitzBaseMsPerPlane?: number`（默认 10_000）可注入小值加速 blitz 判负
（集成测试用）；`timings.*` 沿用 v0.2 注入方式。
