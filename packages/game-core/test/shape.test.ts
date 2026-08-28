/**
 * M1 形状工具测试：normalizeShape / validateShape / rotateShape / boundingBox / occupiedCells / inBounds / SHAPE_SIZE
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLANE_SHAPE, type Cell, type PlaneShape } from '@aero/shared'
import {
  SHAPE_SIZE,
  boundingBox,
  inBounds,
  normalizeShape,
  occupiedCells,
  rotateShape,
  validateShape,
} from '@aero/game-core'

describe('SHAPE_SIZE', () => {
  it('编辑器边长为 5', () => {
    expect(SHAPE_SIZE).toBe(5)
  })
})

describe('normalizeShape', () => {
  it('去重 cells', () => {
    const shape: PlaneShape = {
      cells: [
        { r: 0, c: 0 },
        { r: 0, c: 0 },
        { r: 0, c: 1 },
      ],
      head: { r: 0, c: 0 },
    }
    const norm = normalizeShape(shape)
    expect(norm.cells).toHaveLength(2)
    expect(norm.head).toEqual({ r: 0, c: 0 })
  })

  it('head 不在 cells 内时返回原样（交由 validateShape 判定）', () => {
    const shape: PlaneShape = {
      cells: [
        { r: 0, c: 0 },
        { r: 0, c: 0 },
        { r: 0, c: 1 },
      ],
      head: { r: 2, c: 2 },
    }
    const norm = normalizeShape(shape)
    expect(norm.cells).toEqual(shape.cells)
    expect(norm.head).toEqual(shape.head)
  })

  it('合法形状规范化后与默认形状一致', () => {
    const norm = normalizeShape(DEFAULT_PLANE_SHAPE)
    expect(norm.cells).toEqual(DEFAULT_PLANE_SHAPE.cells)
    expect(norm.head).toEqual(DEFAULT_PLANE_SHAPE.head)
  })
})

describe('rotateShape', () => {
  it('旋转 0 次保持不变', () => {
    const r0 = rotateShape(DEFAULT_PLANE_SHAPE, 0)
    expect(r0.cells).toEqual(DEFAULT_PLANE_SHAPE.cells)
    expect(r0.head).toEqual(DEFAULT_PLANE_SHAPE.head)
  })

  it('单格四向旋转：(0,0) -> (0,4) -> (4,4) -> (4,0)', () => {
    const cell: PlaneShape = { cells: [{ r: 0, c: 0 }], head: { r: 0, c: 0 } }
    expect(rotateShape(cell, 1).cells[0]).toEqual({ r: 0, c: 4 })
    expect(rotateShape(cell, 2).cells[0]).toEqual({ r: 4, c: 4 })
    expect(rotateShape(cell, 3).cells[0]).toEqual({ r: 4, c: 0 })
  })

  it('中心格旋转不变', () => {
    const cell: PlaneShape = { cells: [{ r: 2, c: 2 }], head: { r: 2, c: 2 } }
    expect(rotateShape(cell, 1).cells[0]).toEqual({ r: 2, c: 2 })
    expect(rotateShape(cell, 3).cells[0]).toEqual({ r: 2, c: 2 })
  })

  it('默认形状旋转 1 次 = (r,c) -> (c, 4-r)，机头同步旋转', () => {
    const expected = DEFAULT_PLANE_SHAPE.cells.map((c) => ({ r: c.c, c: 4 - c.r }))
    const expectedHead = { r: DEFAULT_PLANE_SHAPE.head.c, c: 4 - DEFAULT_PLANE_SHAPE.head.r }
    const r1 = rotateShape(DEFAULT_PLANE_SHAPE, 1)
    expect(r1.cells).toEqual(expected)
    expect(r1.head).toEqual(expectedHead)
  })

  it('旋转可复合：rotate(1)×3 === rotate(3)', () => {
    const r1 = rotateShape(DEFAULT_PLANE_SHAPE, 1)
    const r2 = rotateShape(r1, 1)
    const r3 = rotateShape(r2, 1)
    expect(r3.cells).toEqual(rotateShape(DEFAULT_PLANE_SHAPE, 3).cells)
    expect(r3.head).toEqual(rotateShape(DEFAULT_PLANE_SHAPE, 3).head)
  })
})

describe('boundingBox', () => {
  it('默认形状旋转 0 → { w: 5, h: 4 }', () => {
    expect(boundingBox(DEFAULT_PLANE_SHAPE, 0)).toEqual({ w: 5, h: 4 })
  })

  it('默认形状旋转 1 → { w: 4, h: 5 }', () => {
    expect(boundingBox(DEFAULT_PLANE_SHAPE, 1)).toEqual({ w: 4, h: 5 })
  })

  it('默认形状旋转 2 → { w: 5, h: 4 }，旋转 3 → { w: 4, h: 5 }', () => {
    expect(boundingBox(DEFAULT_PLANE_SHAPE, 2)).toEqual({ w: 5, h: 4 })
    expect(boundingBox(DEFAULT_PLANE_SHAPE, 3)).toEqual({ w: 4, h: 5 })
  })

  it('单格任意旋转 → 1×1', () => {
    const cell: PlaneShape = { cells: [{ r: 2, c: 2 }], head: { r: 2, c: 2 } }
    for (const rot of [0, 1, 2, 3] as const) {
      expect(boundingBox(cell, rot)).toEqual({ w: 1, h: 1 })
    }
  })
})

describe('occupiedCells', () => {
  it('旋转 + origin 平移', () => {
    const rotated = rotateShape(DEFAULT_PLANE_SHAPE, 1)
    const cells = occupiedCells({ id: 0, rotation: 1, origin: { r: 1, c: 2 } }, DEFAULT_PLANE_SHAPE)
    expect(cells).toEqual(rotated.cells.map((c) => ({ r: c.r + 1, c: c.c + 2 })))
  })

  it('旋转 0 时即原始形状平移', () => {
    const cells = occupiedCells({ id: 0, rotation: 0, origin: { r: 3, c: 4 } }, DEFAULT_PLANE_SHAPE)
    expect(cells).toEqual(DEFAULT_PLANE_SHAPE.cells.map((c) => ({ r: c.r + 3, c: c.c + 4 })))
  })
})

describe('inBounds', () => {
  it('界内/界外判定', () => {
    expect(inBounds({ r: 0, c: 0 }, 10, 10)).toBe(true)
    expect(inBounds({ r: 9, c: 9 }, 10, 10)).toBe(true)
    expect(inBounds({ r: 10, c: 0 }, 10, 10)).toBe(false)
    expect(inBounds({ r: 0, c: 10 }, 10, 10)).toBe(false)
    expect(inBounds({ r: -1, c: 0 }, 10, 10)).toBe(false)
    expect(inBounds({ r: 0, c: -1 }, 10, 10)).toBe(false)
  })
})

describe('validateShape', () => {
  /** 断言校验失败且错误列表包含某关键字 */
  const expectErrorsContain = (shape: PlaneShape, keyword: string): void => {
    const res = validateShape(shape)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors.join('；')).toContain(keyword)
    }
  }

  it('默认形状通过', () => {
    expect(validateShape(DEFAULT_PLANE_SHAPE)).toEqual({ ok: true })
  })

  it('孤立格（两格不相邻）', () => {
    expectErrorsContain(
      { cells: [{ r: 0, c: 0 }, { r: 2, c: 2 }], head: { r: 0, c: 0 } },
      '孤立',
    )
  })

  it('多连通分量', () => {
    expectErrorsContain(
      {
        cells: [
          { r: 0, c: 0 }, { r: 0, c: 1 },
          { r: 3, c: 3 }, { r: 3, c: 4 },
        ],
        head: { r: 0, c: 0 },
      },
      '孤立',
    )
  })

  it('格数超过 15', () => {
    const cells: Cell[] = []
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) cells.push({ r, c })
    }
    expectErrorsContain({ cells, head: { r: 0, c: 0 } }, '15')
  })

  it('格数少于 2', () => {
    expectErrorsContain({ cells: [{ r: 0, c: 0 }], head: { r: 0, c: 0 } }, '至少')
  })

  it('机头数 0（head 不在 cells 内）', () => {
    expectErrorsContain(
      { cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }], head: { r: 3, c: 3 } },
      '机头',
    )
  })

  it('机头数 2（head 在 cells 中出现两次）', () => {
    expectErrorsContain(
      {
        cells: [{ r: 0, c: 0 }, { r: 0, c: 0 }, { r: 0, c: 1 }],
        head: { r: 0, c: 0 },
      },
      '机头',
    )
  })

  it('越出 5×5', () => {
    expectErrorsContain(
      { cells: [{ r: 0, c: 0 }, { r: 0, c: 5 }], head: { r: 0, c: 0 } },
      '超出',
    )
    expectErrorsContain(
      { cells: [{ r: 0, c: 0 }, { r: 5, c: 0 }], head: { r: 0, c: 0 } },
      '超出',
    )
  })

  it('重复格', () => {
    expectErrorsContain(
      { cells: [{ r: 0, c: 0 }, { r: 0, c: 0 }, { r: 0, c: 1 }], head: { r: 0, c: 1 } },
      '重复',
    )
  })
})
