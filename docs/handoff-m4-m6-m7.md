# M4 / M6 / M7 交接规格（前端集成 Agent 与 QA Agent 用）

> 前置：`docs/design.md`（设计定稿）、`docs/game-core-api.md`（game-core 契约）、`packages/shared/src/index.ts`（协议）。
> M4 依赖 M1+M3 完成；M6 依赖 M4+M5 完成；M7 依赖全部完成。

## M4：单机完整流程（apps/web）

在 M3 的页面骨架上接入 `@aero/game-core`，实现可完整游玩的单机对局。

1. **第 0 步 身份**：对局页顶部显示我方用户名（guestStore）与"电脑"。单机不需要服务端，游客名沿用 localStorage 桩（M6 接真身份后同源）。
2. **第 1 步 摆阵**：
   - 托盘（竖版上/横版左）放 n 个同形状飞机（PlaneGlyph，可旋转）；指针按下后位移 <6px 且 <300ms 松开=点击→顺时针旋转 90°（托盘与网格内均可）；否则拖拽→松手吸附最近格（吸附=origin 取整后夹取到界内）。
   - 从网格拖回托盘/删除区；"清空重摆"、"随机摆阵"（用 game-core AI generateFleet，难度参数用 settings 里的难度）。
   - 重叠检测（两机 occupiedCells 有交集）→ 重叠机叠加中等透明度红色遮罩；越界机同样红遮罩+提示。
   - 常驻校验清单（数量/越界/重叠），全部通过才亮"确认"；确认前可点按钮弹提示（Toast 列出未满足项）。
   - 确认 → `createGame(config...)` + `setFleet(0, planes)`；AI 用 `generateFleet` 摆好（`setFleet(1, ...)`）。
3. **第 2 步 先后手**：等概率随机（Math.random），横幅 1.5s 显示"您先手/您后手"；`createGame` 的 firstMover 与之一致。
4. **第 3~6 步 对战界面**（M3 已搭骨架，补逻辑）：
   - 我方网格（1/2 尺寸，竖版右上/横版右侧居中）：渲染我方阵型 + 对手报点标记（receivedShots：✗/◯/★，盖章质感）+ 被击毁己方飞机暗色层（destroyedPlaneIds 对应机整体暗色+机头★）。
   - 对手报点网格（居中，空）：我方报点标记（shotsFired 渲染）；**击毁只标机头★，绝不显示残骸**。
   - 样式参考图：5×5 + PlaneGlyph（本局形状，含旋转按钮演示）。
   - 状态条："轮到我方报点"/"等待对方报点…"；单机倒计时隐藏。
   - 报点交互（维持原案）：鼠标点格→高亮，再点同一高亮格→报点（点他格转移高亮）；输入框输入坐标+回车/确认→报点；非法坐标抖动+Toast；已报格禁点（灰态）。
   - 我方报点后：`applyShot` 得结果→渲染标记；若 AI 已全灭且无绝地反击→结算；否则 300~900ms 后 AI 报点（`chooseShot`，难度=settings.difficulty）→ 我方网格对应格 0.8s 高亮动画 + 状态条文字"对方报点 Xn：击空/击中/击毁！"→ 渲染 → 轮到我的判断。
   - 绝地反击阶段：状态条提示"绝地反击！您获得一次额外报点机会"；该次报点后按契约判定胜负。
5. **第 7 步 结算**：胜负文案（"恭喜您，您赢了！"/"您输了，下次一定！"）；公开双方真实阵型（我方+AI 的 setFleet 数据渲染两块小棋盘）；统计（turnNo、命中率=hit+kill/总报点、击毁架数）；"再来一局"（同配置重开）+ "返回主页"；对局中退出需二次确认（PaperModal）。
6. **自定义模式接线**：CustomConfig 的校验清单改用 `validateShape`（game-core）；确认后进入摆阵（自定义棋盘与形状）。
7. **设置接线**：难度进单机 AI；"反转 X 和 O"影响两块网格的标记渲染（✗↔◯ 互换显示）；音量经 audioService（M7 实现，本阶段留接口）。
8. **测试**：vitest 组件级最小用例（可选）；Playwright e2e 由 M7 统一补，M4 至少保证手测全流程无 console error。

## M6：联机前端（apps/web）

接入 `@aero/server`（M5），实现三种入口。

1. **Socket 服务**（apps/web/src/net/socket.ts）：socket.io-client 单例，typed ClientToServer/ServerToClient；连接后 `auth({token})` 存 identity；断线自动重连时 `reconnect({token, gameId})`。
2. **局域网对局**：创建房间（选档位/自定义）→ 展示 6 位房码 + 复制按钮 + （可选）二维码；输入房码加入。
3. **公网匹配**：三档选择 → `createRoom` 由服务端匹配队列配对（或独立 matchmaking 事件按 M5 实现）→ 匹配中动画（30s 超时提示自建房间）。
4. **自定义房间**：房主配置棋盘+形状（加入者只读预览形状与配置）→ 双方摆阵（placeFleet/ready，双方就绪后服务端随机先手）。
5. **对局 UI**：复用 M4 对战组件，状态由服务端事件驱动（phaseChange/turnStart/shotResult/timerUpdate/gameEnd）；倒计时可见（deadline 渲染秒数 + chancesLeft 显示"剩余超时机会"）；非我方回合报点入口禁用；机器接管 banner；断线横幅（60s 倒计时，重连成功自动消失）；"投降"按钮（二次确认）；结算页展示双方阵型+stats。
6. **房内体验**：双方用户名列表、就绪状态、退出房间二次确认。
7. **测试**：与 M5 集成测试对齐的手测脚本；双浏览器（普通+隐身）全流程。

## M7：打磨验收（QA Agent）

1. **音效**：Web Audio 解锁（首次交互 resume）；程序合成或 CC0 素材——铅笔沙沙（报点）、盖章（结果）、纸张翻动（切页）、轻 BGM 循环；audioService 接设置双推杆；BGM/音效独立增益。
2. **动效**：0.8s 对手报点高亮、横幅、结算翻页；prefers-reduced-motion 全禁用。
3. **无障碍**：按钮/label/focus-visible、键盘可完成一局（Tab+Enter）、aria-live 播报报点结果。
4. **响应式验收**：375px 竖屏、1280px 横屏、26×26 自定义棋盘无溢出（必要时滚动/最小格宽）。
5. **Playwright e2e**（apps/web/e2e/）：主页→单机三档→摆阵→完整对局→结算→再来一局；自定义编辑器校验清单逐条触发（孤立格/超格数/0 机头）；设置持久化（刷新后保留）；双浏览器联机全流程（建房→入房→摆阵→对局→结算）；断线 60s 重连；读秒超时→机器接管。
6. **性能冒烟**：对局中持续 60fps（无布局抖动）、无内存泄漏（监听器随组件卸载）。
7. **收尾**：CHANGELOG 补全、v1.0 tag、README 运行说明最终核对。

## 验收口径（v1.0）

全功能现场可演示；控制台零报错；桌面横版与手机竖版可用；联机双端画面一致；CI `pnpm check:ci` 全绿。
