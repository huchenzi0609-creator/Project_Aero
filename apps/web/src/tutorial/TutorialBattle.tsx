/**
 * TutorialBattle —— 教程单元2/3：对局（v0.3.0）。
 *
 * - 单元2 basic：沿用单元1 阵型开局（gameStore.beginTutorialBattle，我方先手，经典模式）；
 *   对手 AI = chooseTutorialShot(avoidHeads=我方全部机头)——绝不爆头，保证教程可继续；
 *   步骤机按手稿 T2-1~T2-6 推进，玩家获胜后弹 P3「基础教程已完成…」。
 * - 单元3 advanced：createEndgameState 残局（我方随机阵型、planeIndex 0 已被击毁、对方先手）；
 *   步骤机 T3-1~T3-12；每 AI 回合留 6s 窗口供玩家操作（涂色/幽灵/预报点），
 *   创建预报点后 AI 暂停约 5s；步骤完成弹 P5「进阶教程已完成…」。
 * - AI 节奏控制走 GameScreen.aiShotSelector：返回 null = 本帧不出手（教程暂停/思考窗口）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, GridConfig, PlacedPlane } from '@aero/shared'
import { PRESETS } from '@aero/shared'
import { rotateShape } from '@aero/game-core'
import { chooseTutorialShot, generateFleet, mulberry32 } from '@aero/game-core/ai'
import type { Rng, ShotKnowledge } from '@aero/game-core/ai'
import { useGameStore } from '../store/gameStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { GameScreen } from '../pages/GameScreen'
import { useSteps } from './stepMachine'
import type { TutorialStep } from './stepMachine'
import { TutorialBubble } from './TutorialBubble'
import { TutorialSpotlight } from './TutorialSpotlight'
import type { TutorialGameEvent } from './events'

/* ---------------- 单元2 步骤（手稿 §5.4，逐字） ---------------- */

const T2_STEPS: TutorialStep[] = [
  { key: 't21', text: ['是时候学习如何对战了！'] },
  { key: 't22', text: ['我们要在这张网格上找出对手的飞机机头的位置，但是目前还一无所知呢。'], highlight: '.game__opp' },
  { key: 't23', text: ['试试双击一个格子，我们就能知道对手的这个位置有没有飞机了。'], wait: 'shotByPlayer' },
  {
    key: 't24',
    text: (e) => {
      if (e?.type === 'shotByPlayer') {
        return e.outcome === 'hit'
          ? ['机头就在这附近！但是信息还不够多，再在附近试试吧！']
          : ['哎呀，不走运，这里没有飞机呢，点击其他方格试试吧！']
      }
      return ['哎呀，不走运，这里没有飞机呢，点击其他方格试试吧！']
    },
  },
  {
    key: 't25',
    text: [
      '厉害！你摧毁了对手的一架飞机！',
      '注意，对已击毁的飞机报点将显示*击空*哦！',
      '现在，请你继续找出所有飞机的机头！',
    ],
    wait: (e) => e.type === 'planeKilled' && e.side === 1,
  },
  { key: 't26', text: ['恭喜！你获得了一场胜利！'], wait: 'playerWin' },
]

/* ---------------- 单元3 步骤（手稿 §5.6，逐字） ---------------- */

const T3_STEPS: TutorialStep[] = [
  { key: 't31', text: ['《飞机杀》有很多实用的对局工具呢！'] },
  { key: 't32', text: ['这是“参考网格”。如果忘了飞机长什么样子，可以看这里！', '这里的飞机也可点击旋转90度！'], highlight: '.game__ref' },
  { key: 't33', text: ['并且，这里的飞机也可以拖到空网格里。试试看！'], highlight: '.game__ref', wait: 'ghostCreated' },
  {
    key: 't34',
    text: ['你创建了一个幽灵飞机！它可以用来直观地判断飞机位置。', '你可以创建多个幽灵飞机，回收它们只需要将其拖回去即可。'],
  },
  { key: 't35', text: ['这是“我方网格”。可以看到我方阵型以及被击毁情况，以及对方报点的详细情况。'], highlight: '.game__mine' },
  {
    key: 't36',
    text: [
      '值得一提的是，如果对方先手，在对方击毁了我方所有飞机后，……',
      '如果对方也只剩一架飞机未被击毁，那么我方将会获得一次额外报点机会。',
      '如果这次报点我方击毁了对方的最后一架飞机，则我方胜利。',
      '这就是“绝杀”规则。',
    ],
  },
  { key: 't37', text: ['这是坐标输入框，网格太小不便点击时，可输入坐标进行报点。'], highlight: '.game__inputbar' },
  { key: 't38', text: ['点击这个按钮进入着色模式，长按可以选择颜色。'], highlight: '.game__inputbar .coloring-btn', wait: 'enteredColoring' },
  { key: 't39', text: ['试试看给空网格涂色，点击和拖动都可以！'], wait: 'cellColored' },
  {
    key: 't310',
    text: [
      '着色工具是对局中的好帮手，可助您事半功倍。',
      '这一强大的工具搭配“幽灵飞机”变得更为强大。',
      '试试看！在着色模式下点击“幽灵飞机”。',
    ],
  },
  {
    key: 't311',
    text: [
      '你刚刚对幽灵飞机下的方格进行了一次批量着色！',
      '使用批量着色功能会自动消灭选中的幽灵飞机，并且退出着色模式。',
      '若不想消灭和退出，可以在设置中关闭“快捷着色”。',
      '现在，灵活使用这些工具继续对局吧！',
    ],
    wait: 'ghostBatchColored',
  },
  {
    key: 't312',
    text: [
      '你刚刚创建了一个预报点标记！',
      '在真实对局中，常常出现对手陷入长考的局面。',
      '为了节省我方时间，你可以在对方轮次时创建预报点标记。',
      '我方轮次时，将会自动按顺序上报这些预报点。',
      '请注意，预报点标记最多同时存在10个。',
    ],
    wait: 'preFireCreated',
  },
]

export interface TutorialBattleProps {
  variant: 'basic' | 'advanced'
  /** 单元2 沿用玩家阵型（basic）；advanced 传 null（内部随机） */
  fleet: PlacedPlane[] | null
  onExitHome: () => void
  /** P4「继续教程」→ 进阶单元3 */
  onGoAdvanced: () => void
}

/** 机头绝对坐标（含残骸机；教学 AI 规避用） */
function headCells(planes: PlacedPlane[], shape: GridConfig['shape']): Cell[] {
  const out: Cell[] = []
  for (const p of planes) {
    const head = rotateShape(shape, p.rotation).head
    out.push({ r: head.r + p.origin.r, c: head.c + p.origin.c })
  }
  return out
}

/** 残骸已毁机在 planes 中下标 0（advanced preKill planeIndex=0），供教学说明可省 */

export function TutorialBattle({ variant, fleet, onExitHome, onGoAdvanced }: TutorialBattleProps) {
  const toast = useToastStore((s) => s.push)
  const begin = useGameStore((s) => s.beginTutorialBattle)
  const beginEndgame = useGameStore((s) => s.beginTutorialEndgame)
  const resetGame = useGameStore((s) => s.reset)
  const difficulty = useSettingsStore((s) => s.difficulty)

  const config: GridConfig = useMemo(() => ({ ...PRESETS.small }), [])
  const steps = useMemo(() => (variant === 'basic' ? T2_STEPS : T3_STEPS), [variant])
  const [startFailed, setStartFailed] = useState(false)
  const [p3Open, setP3Open] = useState(false)
  const [p5Open, setP5Open] = useState(false)
  const [free, setFree] = useState(false) // advanced「继续对局」后：不再出气泡/遮罩，AI 恢复节奏
  const sessionNonce = useGameStore((s) => s.session?.nonce ?? 0)

  // 步骤完成 → 弹结束弹窗（basic → P3 / advanced → P5）；useSteps onDone 经 ref 转发
  const onStepsDone = useCallback(() => {
    if (variant === 'basic') setP3Open(true)
    else setP5Open(true)
  }, [variant])
  const doneRef = useRef(onStepsDone)
  doneRef.current = onStepsDone
  const stepsMachine = useSteps(steps, () => doneRef.current())

  /* AI 门控（ref：GameScreen.aiShotSelector 每 400ms 轮询读取最新） */
  const gateRef = useRef({
    delayMs: 0, // 每 AI 回合思考窗口
    pausedUntil: 0,
    lastShots: 0,
    armed: false, // 进入后首个 AI 回合也吃 delay
  })

  // 开局（挂载一次）：basic 沿用玩家阵型；advanced 随机双方阵型 + 残局注入
  useEffect(() => {
    const doStart = () => {
      resetGame()
      if (variant === 'basic') {
        if (!fleet || fleet.length === 0) {
          setStartFailed(true)
          return
        }
        const res = begin(config, fleet)
        if (!res.ok) {
          toast(res.errors.join('；'), 'error')
          setStartFailed(true)
          return
        }
        gateRef.current = { delayMs: 0, pausedUntil: 0, lastShots: 0, armed: false }
      } else {
        const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
        try {
          const myFleet = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, rng)
          const oppFleet = generateFleet(config.width, config.height, config.planeCount, config.shape, difficulty, rng)
          const res = beginEndgame(config, myFleet, oppFleet, {
            preKill: { side: 'me', planeIndex: 0 },
            firstTurn: 'them',
          })
          if (!res.ok) {
            toast(res.errors.join('；'), 'error')
            setStartFailed(true)
            return
          }
        } catch (err) {
          toast(err instanceof Error ? err.message : '教程对局生成失败', 'error')
          setStartFailed(true)
          return
        }
        gateRef.current = { delayMs: 6000, pausedUntil: 0, lastShots: 0, armed: false }
      }
    }
    doStart()
  }, [variant])

  // 新对局开始：步骤机从第一步走起（advanced 也从头教学）
  useEffect(() => {
    if (sessionNonce > 0) stepsMachine.restart()
  }, [sessionNonce, variant])

  /** 教程 AI 决策：avoidHeads=我方全部机头；advanced 每回合思考窗口 6s；null=暂停（本帧不出手） */
  const aiShotSelector = useCallback((knowledge: ShotKnowledge, rng: Rng): Cell | null => {
    const g = gateRef.current
    const now = Date.now()
    // 新 AI 回合（对方射击历史长度变化）→ 重置思考窗口
    if (g.lastShots !== knowledge.shots.length) {
      g.lastShots = knowledge.shots.length
      if (g.delayMs > 0) g.pausedUntil = now + g.delayMs
    }
    if (now < g.pausedUntil) return null
    // 规避我方全部机头（含残骸机，无害）
    const s = useGameStore.getState()
    const myPlanes = s.session?.state.players[0].planes ?? []
    const shape = s.session?.state.players[0].shape ?? config.shape
    return chooseTutorialShot(knowledge, { avoidHeads: headCells(myPlanes, shape) }, rng)
  }, [config.shape])

  // 事件桥：转发步骤机；preFireCreated → AI 额外暂停约 5s（T3-12 教学窗口）
  const onGameEvent = useCallback(
    (e: TutorialGameEvent) => {
      stepsMachine.dispatch(e)
      if (e.type === 'preFireCreated' && variant === 'advanced' && !free) {
        const g = gateRef.current
        g.pausedUntil = Math.max(g.pausedUntil, Date.now() + 5000)
      }
    },
    [stepsMachine, variant, free],
  )

  // 清理：卸载即重置对局（宿主负责 stage 切换；free 继续对局保留到自然终局）
  useEffect(
    () => () => {
      // 切换单元时由宿主统一 resetGame；此处不重置以免 free 阶段误清
    },
    [],
  )

  const showBubble = !free && stepsMachine.index >= 0 && stepsMachine.segments.length > 0
  const segText = showBubble
    ? (stepsMachine.segments[Math.min(stepsMachine.seg, stepsMachine.segments.length - 1)] ?? '')
    : ''
  const highlight = !free && stepsMachine.index >= 0 && stepsMachine.step?.highlight
    ? stepsMachine.step.highlight
    : null

  if (startFailed) {
    return (
      <div className="page" style={{ alignItems: 'center', gap: 16 }}>
        <p>教程对局启动失败，请返回主页重试。</p>
        <PaperButton variant="primary" onClick={onExitHome}>
          返回主页
        </PaperButton>
      </div>
    )
  }

  const unitLabel = variant === 'basic' ? '对战基础' : '工具进阶'

  return (
    <>
      <GameScreen onGameEvent={onGameEvent} aiShotSelector={free ? undefined : aiShotSelector} />

      {/* 右上角跳过（进入下一流程：basic 跳过 → 视为完成 → P3；advanced 跳过 → 视为完成 → P5） */}
      {!free ? (
        <div className="tutorial-hud">
          <button
            type="button"
            className="tutorial-bubble__skip"
            onClick={() => (variant === 'basic' ? setP3Open(true) : setP5Open(true))}
          >
            跳过 · {unitLabel}
          </button>
        </div>
      ) : null}

      {free ? null : <TutorialSpotlight target={highlight} />}
      {showBubble && stepsMachine.step ? (
        <TutorialBubble
          key={`${variant}-${stepsMachine.step.key}-${stepsMachine.seg}`}
          text={segText}
          onClick={() => stepsMachine.click()}
          skipLabel={`跳过 · ${unitLabel}`}
          onSkip={() => (variant === 'basic' ? setP3Open(true) : setP5Open(true))}
        />
      ) : null}

      {/* P3 基础完成弹窗（手稿 §5.5） */}
      <PaperModal
        open={p3Open}
        title="基础教程"
        onClose={() => {}}
        footer={
          <>
            <PaperButton variant="ghost" onClick={onExitHome}>
              返回主页
            </PaperButton>
            <PaperButton variant="primary" onClick={onGoAdvanced}>
              继续教程
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>基础教程已完成，是否继续进阶教程？</p>
      </PaperModal>

      {/* P5 进阶完成弹窗（手稿 §5.7） */}
      <PaperModal
        open={p5Open}
        title="进阶教程"
        onClose={() => {}}
        footer={
          <>
            <PaperButton variant="ghost" onClick={onExitHome}>
              完成教程
            </PaperButton>
            <PaperButton
              variant="primary"
              onClick={() => {
                // 继续对局：留在当前对局，AI 恢复节奏（free 后 aiShotSelector 退场走默认 AI）
                gateRef.current = { ...gateRef.current, delayMs: 0, pausedUntil: 0, armed: false }
                setFree(true)
                setP5Open(false)
              }}
            >
              继续对局
            </PaperButton>
          </>
        }
      >
        <p style={{ margin: 0 }}>进阶教程已完成，是否完成对局？</p>
      </PaperModal>
    </>
  )
}
