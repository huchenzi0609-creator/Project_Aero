import { useMemo, useState } from 'react'
import { DEFAULT_PLANE_SHAPE, GRID_MAX, GRID_MIN, SHAPE_MAX_CELLS } from '@aero/shared'
import type { Cell, PlaneShape } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { useToastStore } from '../store/toastStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperToggle } from '../components/ui/PaperToggle'
import { PlaneGlyph } from '../components/grid/PlaneGlyph'
import { checkShape, normalizeShape, shapeBBox, shapeIsValid } from '../lib/shape'

const EDITOR_SIZE = 5

function cellKey(p: Cell): string {
  return `${p.r},${p.c}`
}

export function CustomConfig() {
  const setView = useAppStore((s) => s.setView)
  const setGridConfig = useAppStore((s) => s.setGridConfig)
  const toast = useToastStore((s) => s.push)

  const [widthText, setWidthText] = useState('10')
  const [heightText, setHeightText] = useState('10')
  const [planeText, setPlaneText] = useState('3')
  const [useDefault, setUseDefault] = useState(true)
  const [cells, setCells] = useState<Cell[]>([])
  const [head, setHead] = useState<Cell | null>(null)
  const [mode, setMode] = useState<'paint' | 'erase'>('paint')

  const width = Number(widthText)
  const height = Number(heightText)
  const planeCount = Number(planeText)
  const widthOk = Number.isInteger(width) && width >= GRID_MIN && width <= GRID_MAX
  const heightOk = Number.isInteger(height) && height >= GRID_MIN && height <= GRID_MAX
  const maxN = widthOk && heightOk ? Math.floor((width * height) / 25) : 0
  const nOk = Number.isInteger(planeCount) && planeCount >= 1 && planeCount <= maxN

  const drawnShape: PlaneShape | null =
    head && cells.length > 0 ? normalizeShape({ cells, head }) : null
  const shape: PlaneShape = useDefault ? DEFAULT_PLANE_SHAPE : (drawnShape ?? { cells: [], head: { r: 0, c: 0 } })

  const checks = useMemo(() => {
    if (useDefault) return { connected: true, cellCount: DEFAULT_PLANE_SHAPE.cells.length, headCount: 1 }
    if (!drawnShape) return { connected: false, cellCount: 0, headCount: 0 }
    return checkShape(drawnShape)
  }, [useDefault, drawnShape])

  const shapeValid = useDefault || (drawnShape !== null && shapeIsValid(checks))
  const canConfirm = widthOk && heightOk && nOk && shapeValid

  function paintAt(cell: Cell) {
    const key = cellKey(cell)
    const exists = cells.some((p) => cellKey(p) === key)
    if (exists) {
      if (head && cellKey(head) === key) {
        setHead(null) // 移除机头（回到机身灰）
        return
      }
      setHead(cell) // 此格设为机头，旧机头自动降回机身
      return
    }
    if (cells.length >= SHAPE_MAX_CELLS) {
      toast('已达 15 格上限，请先擦除部分格子', 'error')
      return
    }
    const next = [...cells, cell]
    setCells(next)
    if (!head) setHead(cell) // 第一格自动成为机头
  }

  function eraseAt(cell: Cell) {
    const key = cellKey(cell)
    setCells((prev) => prev.filter((p) => cellKey(p) !== key))
    if (head && cellKey(head) === key) setHead(null)
  }

  function clearAll() {
    setCells([])
    setHead(null)
  }

  function confirm() {
    setGridConfig({ width, height, planeCount, shape })
    setView('game')
  }

  const previewShape = useDefault ? DEFAULT_PLANE_SHAPE : drawnShape
  const previewB = previewShape ? shapeBBox(previewShape.cells) : null
  const pCell = 30

  const checkItems = [
    {
      key: 'connected',
      label: '四邻连通',
      pass: checks.connected && checks.cellCount > 0,
      detail:
        checks.cellCount === 0 ? '尚未绘制任何格子' : checks.connected ? '所有已填格连成一块' : '存在断开的格子',
    },
    {
      key: 'count',
      label: `格数 2 ~ ${SHAPE_MAX_CELLS}`,
      pass: checks.cellCount >= 2 && checks.cellCount <= SHAPE_MAX_CELLS,
      detail: `当前 ${checks.cellCount} 格`,
    },
    {
      key: 'head',
      label: '机头恰 1 个',
      pass: checks.headCount === 1,
      detail: `当前 ${checks.headCount} 个`,
    },
  ]

  return (
    <div className="page custom">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('single')}>
        ← 返回单人对局
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">自定义配置</h1>
          <p className="page__subtitle">自由设定棋盘尺寸与飞机形状，全部校验通过后才能开战。</p>
        </div>
      </header>

      <div className="page__body custom__cols">
        {/* 左栏：棋盘参数 */}
        <PaperCard tape>
          <h2 className="settings__section-title">棋盘与飞机数量</h2>
          <div className="custom__field">
            <label className="custom__label" htmlFor="cfg-width">
              宽（{GRID_MIN}–{GRID_MAX}）
              <span className="custom__hint">横向列数，字母标号</span>
            </label>
            <div className="custom__inputrow">
              <input
                id="cfg-width"
                className={['custom__input', !widthOk ? 'custom__input--invalid' : ''].filter(Boolean).join(' ')}
                type="number"
                min={GRID_MIN}
                max={GRID_MAX}
                value={widthText}
                onChange={(e) => setWidthText(e.target.value)}
                aria-invalid={!widthOk}
              />
              <input
                id="cfg-height"
                className={['custom__input', !heightOk ? 'custom__input--invalid' : ''].filter(Boolean).join(' ')}
                type="number"
                min={GRID_MIN}
                max={GRID_MAX}
                value={heightText}
                onChange={(e) => setHeightText(e.target.value)}
                aria-label="高"
                aria-invalid={!heightOk}
              />
            </div>
            <p className="custom__err" role="alert">
              {!widthOk || !heightOk ? `宽与高需为 ${GRID_MIN}–${GRID_MAX} 之间的整数` : ''}
            </p>
          </div>

          <div className="custom__field">
            <label className="custom__label" htmlFor="cfg-planes">
              飞机数 n
              <span className="custom__num">上限 ⌊宽×高÷25⌋ = {maxN}</span>
            </label>
            <input
              id="cfg-planes"
              className={['custom__input', !nOk ? 'custom__input--invalid' : ''].filter(Boolean).join(' ')}
              type="number"
              min={1}
              max={Math.max(maxN, 1)}
              value={planeText}
              onChange={(e) => setPlaneText(e.target.value)}
              aria-invalid={!nOk}
            />
            <p className="custom__err" role="alert">
              {!nOk ? `飞机数需为 1 ~ ${maxN} 之间的整数` : ''}
            </p>
          </div>

          <div className="custom__toggle-row">
            <PaperToggle
              label="使用默认飞机形状"
              description="默认 4×5 共 10 格：机头 1、机翼 5、机身 1、机尾 3（左右对称）。"
              checked={useDefault}
              onChange={setUseDefault}
            />
          </div>
        </PaperCard>

        {/* 右栏：形状编辑器 + 校验清单 */}
        <PaperCard pin>
          <div className="editor-head">
            <h2 className="page__subtitle" style={{ margin: 0 }}>
              飞机形状编辑器
            </h2>
            <span className="editor-count">
              已填格数：{useDefault ? DEFAULT_PLANE_SHAPE.cells.length : cells.length} / {SHAPE_MAX_CELLS}
            </span>
          </div>

          <div className="editor-tools">
            <PaperButton
              size="sm"
              variant={mode === 'paint' ? 'primary' : 'ghost'}
              aria-pressed={mode === 'paint'}
              onClick={() => setMode('paint')}
            >
              绘制
            </PaperButton>
            <PaperButton
              size="sm"
              variant={mode === 'erase' ? 'primary' : 'ghost'}
              aria-pressed={mode === 'erase'}
              onClick={() => setMode('erase')}
            >
              橡皮擦
            </PaperButton>
            <PaperButton size="sm" variant="ghost" onClick={clearAll}>
              清空
            </PaperButton>
          </div>

          <div className={useDefault ? 'shape-editor shape-editor--disabled' : 'shape-editor'}>
            <div className="shape-editor__board" role="group" aria-label="5×5 飞机形状编辑器">
              {Array.from({ length: EDITOR_SIZE }, (_, r) =>
                Array.from({ length: EDITOR_SIZE }, (_, c) => {
                  const filled = cells.some((p) => cellKey(p) === cellKey({ r, c }))
                  const isHead = head !== null && cellKey(head) === cellKey({ r, c })
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={[
                        'shape-editor__cell',
                        isHead ? 'shape-editor__cell--head' : filled ? 'shape-editor__cell--filled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`第${r + 1}行第${c + 1}列：${isHead ? '机头' : filled ? '机身' : '空白'}`}
                      aria-pressed={filled}
                      onClick={() => (mode === 'paint' ? paintAt({ r, c }) : eraseAt({ r, c }))}
                    />
                  )
                }),
              )}
            </div>
          </div>

          <div className="editor-legend" aria-hidden="true">
            <span>
              <span className="legend-swatch" /> 空白
            </span>
            <span>
              <span className="legend-swatch legend-swatch--filled" /> 机身
            </span>
            <span>
              <span className="legend-swatch legend-swatch--head" /> 机头
            </span>
          </div>

          {useDefault ? <p className="custom__hint">已锁定默认飞机形状（M4 起可自由绘制）。</p> : null}

          {/* 常驻校验清单 */}
          <ul className="checklist" style={{ listStyle: 'none', paddingLeft: 0 }}>
            {checkItems.map((item) => (
              <li key={item.key} className="checklist__item">
                <span className={['checklist__mark', item.pass ? 'checklist__mark--ok' : 'checklist__mark--no'].join(' ')}>
                  {item.pass ? '✓' : '✗'}
                </span>
                <span>{item.label}</span>
                <span className="checklist__detail">{item.detail}</span>
              </li>
            ))}
          </ul>

          {/* 实时预览 */}
          <h2 className="settings__section-title" style={{ marginTop: 8 }}>
            实时预览
          </h2>
          <div className="plane-preview">
            {previewShape && previewB ? (
              <div
                style={{
                  width: (previewB.c1 - previewB.c0 + 1) * pCell,
                  height: (previewB.r1 - previewB.r0 + 1) * pCell,
                }}
              >
                <PlaneGlyph shape={previewShape} rotation={0} />
              </div>
            ) : (
              <span className="plane-preview__empty">在左侧画出一个格子即可预览</span>
            )}
          </div>

          <div className="custom__actions">
            <PaperButton variant="ghost" onClick={() => setView('single')}>
              取消
            </PaperButton>
            <PaperButton variant="primary" disabled={!canConfirm} onClick={confirm}>
              确认 · 进入对局
            </PaperButton>
          </div>
        </PaperCard>
      </div>
    </div>
  )
}
