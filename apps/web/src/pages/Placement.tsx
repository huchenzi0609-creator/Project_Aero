/**
 * Placement —— 单机摆阵页（M4 交付物 1，M6 起复用 FleetPlacementBoard）。
 *
 * 交互（托盘/拖拽/旋转/校验）由 FleetPlacementBoard 提供；
 * 本页负责：头部（标题/难度/清空/随机/确认）、常驻校验清单、退出二次确认，
 * 确认后 gameStore.begin() → createGame + setFleet(0, 我方) + AI generateFleet + setFleet(1)。
 */
import { useEffect, useRef, useState } from 'react'
import type { PlacedPlane } from '@aero/shared'
import { generateFleet, mulberry32 } from '@aero/game-core/ai'
import { useAppStore } from '../store/appStore'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { useGameStore } from '../store/gameStore'
import { audioService } from '../lib/audioService'
import { useEffectiveOrientation } from '../hooks/useOrientation'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperModal } from '../components/ui/PaperModal'
import { FleetPlacementBoard, fleetCheckState } from '../components/placement/FleetPlacementBoard'
import type { TutorialGameEvent } from '../tutorial/events'

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '简单',
  normal: '正常',
  hard: '困难',
  hell: '地狱',
}

interface PlacementProps {
  /** 教程事件钩子（v0.3.0 预留，M8 TutorialProvider 注入；为空零开销） */
  onGameEvent?: (e: TutorialGameEvent) => void
}

export function Placement({ onGameEvent }: PlacementProps) {
  const config = useAppStore((s) => s.gridConfig)
  const setView = useAppStore((s) => s.setView)
  const placementOrigin = useAppStore((s) => s.placementOrigin)
  const toast = useToastStore((s) => s.push)
  const begin = useGameStore((s) => s.begin)
  const difficulty = useSettingsStore((s) => s.difficulty)
  const orientation = useEffectiveOrientation()

  const { width, height, planeCount, shape } = config

  const [grid, setGrid] = useState<PlacedPlane[]>([])
  const [exitOpen, setExitOpen] = useState(false)

  const check = fleetCheckState(grid, config)
  const canConfirm = check.ok

  /* ---------- v0.3.0 教程埋点：飞机拖入 / 旋转事件（对机队做单架增量比对） ---------- */
  const prevGridRef = useRef<PlacedPlane[]>(grid)
  const handlePlanesChange = (next: PlacedPlane[]) => {
    const prev = prevGridRef.current
    // 仅单架增量（真实拖入）逐架补发 planePlaced；随机/清空等批量变化不逐架发
    if (next.length - prev.length === 1) {
      const added = next.find((p) => !prev.some((q) => q.id === p.id))
      if (added) onGameEvent?.({ type: 'planePlaced', planeId: added.id })
    }
    // 旋转：同 id 旋转值变化（单击旋转，与数量增量正交）
    if (next.length - prev.length <= 1) {
      const prevRot = new Map(prev.map((p) => [p.id, p.rotation]))
      for (const np of next) {
        const pr = prevRot.get(np.id)
        if (pr !== undefined && pr !== np.rotation) onGameEvent?.({ type: 'planeRotated', planeId: np.id })
      }
    }
    prevGridRef.current = next
    setGrid(next)
  }

  // 全部入格 / 阵形合法 上升沿事件
  const prevFullRef = useRef(grid.length === planeCount)
  useEffect(() => {
    const full = grid.length === planeCount
    if (full && !prevFullRef.current) onGameEvent?.({ type: 'allPlanesPlaced' })
    prevFullRef.current = full
  }, [grid.length, planeCount, onGameEvent])

  const prevValidRef = useRef(check.ok)
  useEffect(() => {
    if (check.ok && !prevValidRef.current) onGameEvent?.({ type: 'formationValid' })
    prevValidRef.current = check.ok
  }, [check.ok, onGameEvent])

  const clearAll = () => handlePlanesChange([])

  const randomFleet = () => {
    const diff = useSettingsStore.getState().difficulty
    const rng = mulberry32(((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1)
    try {
      const fleet = generateFleet(width, height, planeCount, shape, diff, rng)
      handlePlanesChange(fleet)
      toast(`已按「${DIFFICULTY_LABEL[diff] ?? diff}」难度随机摆阵`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '随机摆阵失败，请手动摆放', 'error')
    }
  }

  const confirm = () => {
    if (!canConfirm) {
      const errors = [
        ...(!check.countOk ? [`飞机数量不足：${grid.length}/${planeCount} 架`] : []),
        ...(!check.boundsOk ? ['有飞机超出边界'] : []),
        ...(!check.overlapOk ? ['存在飞机重叠'] : []),
      ]
      toast(`摆阵未通过：${errors.join('；')}`, 'error')
      return
    }
    const res = begin(config, grid)
    if (!res.ok) {
      toast(res.errors.join('；'), 'error')
      return
    }
    onGameEvent?.({ type: 'confirmPlacement' })
    audioService.playSfx('page-flip')
    setView('game')
  }

  const back = () => {
    setView(placementOrigin === 'custom' ? 'custom' : 'single')
  }

  const checkItems = [
    { key: 'count', label: '数量', pass: check.countOk, detail: `${grid.length} / ${planeCount} 架` },
    { key: 'bounds', label: '越界', pass: check.boundsOk, detail: `${check.flags.outOfBoundsIds.size} 架` },
    { key: 'overlap', label: '重叠', pass: check.overlapOk, detail: `${check.flags.overlapIds.size} 架` },
  ]

  return (
    <div className={`placement placement--${orientation}`}>
      <header className="placement__head">
        <PaperButton size="sm" variant="ghost" onClick={() => setExitOpen(true)}>
          ← 返回
        </PaperButton>
        <div>
          <h1 className="page__title" style={{ fontSize: 22 }}>
            摆阵 · 单人对局
          </h1>
          <p className="page__subtitle" style={{ fontSize: 13 }}>
            {width}×{height} · {planeCount} 架飞机 · 难度：{DIFFICULTY_LABEL[difficulty] ?? '正常'}
            <span className="placement__hint"> 点击飞机旋转 · 拖拽摆放 · 拖回托盘回收</span>
          </p>
        </div>
        <div className="placement__controls">
          <PaperButton size="sm" variant="ghost" onClick={clearAll} disabled={grid.length === 0}>
            清空重摆
          </PaperButton>
          <PaperButton size="sm" variant="ghost" onClick={randomFleet} disabled={grid.length === planeCount}>
            随机摆阵
          </PaperButton>
          <PaperButton
            size="sm"
            variant="primary"
            className={canConfirm ? '' : 'placement__confirm--pending'}
            onClick={confirm}
          >
            确认布阵
          </PaperButton>
        </div>
      </header>

      <FleetPlacementBoard
        config={config}
        planes={grid}
        onPlanesChange={handlePlanesChange}
        portraitChromeReserve={345}
      />

      {/* 底部：常驻校验清单 */}
      <footer className="placement__foot">
        <ul className="checklist placement__checklist">
          {checkItems.map((item) => (
            <li key={item.key} className="checklist__item">
              <span
                className={['checklist__mark', item.pass ? 'checklist__mark--ok' : 'checklist__mark--no'].join(' ')}
              >
                {item.pass ? '✓' : '✗'}
              </span>
              <span>{item.label}</span>
              <span className="checklist__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
        <span className="placement__status" role="status" aria-live="polite">
          {canConfirm ? '校验通过，可以确认布阵！' : '校验未通过，请调整飞机位置'}
        </span>
      </footer>

      <PaperModal
        open={exitOpen}
        title="退出摆阵？"
        onClose={() => setExitOpen(false)}
        footer={
          <>
            <PaperButton variant="ghost" onClick={() => setExitOpen(false)}>
              继续摆阵
            </PaperButton>
            <PaperButton variant="danger" onClick={back}>
              确认退出
            </PaperButton>
          </>
        }
      >
        返回后当前摆放将丢失，尚未开始的单人对局不会记录。
      </PaperModal>
    </div>
  )
}
