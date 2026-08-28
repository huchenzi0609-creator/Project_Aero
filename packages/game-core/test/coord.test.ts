/**
 * M1 坐标工具测试：parseCoord / formatCoord
 */
import { describe, expect, it } from 'vitest'
import { formatCoord, parseCoord } from '@aero/game-core'

describe('parseCoord', () => {
  it('A5 -> { r: 4, c: 0 }', () => {
    expect(parseCoord('A5')).toEqual({ r: 4, c: 0 })
  })

  it('小写容错', () => {
    expect(parseCoord('a5')).toEqual({ r: 4, c: 0 })
  })

  it('首尾空格容错', () => {
    expect(parseCoord('  A5  ')).toEqual({ r: 4, c: 0 })
    expect(parseCoord('\tA5\n')).toEqual({ r: 4, c: 0 })
  })

  it('大棋盘坐标 Z26 -> { r: 25, c: 25 }', () => {
    expect(parseCoord('Z26')).toEqual({ r: 25, c: 25 })
  })

  it('A1 -> { r: 0, c: 0 }', () => {
    expect(parseCoord('A1')).toEqual({ r: 0, c: 0 })
  })

  it('非法输入返回 null', () => {
    expect(parseCoord('5A')).toBeNull() // 数字开头
    expect(parseCoord('AA')).toBeNull() // 无行号
    expect(parseCoord('')).toBeNull() // 空串
    expect(parseCoord('   ')).toBeNull() // 纯空白
    expect(parseCoord('A 5')).toBeNull() // 中间空格
    expect(parseCoord('A0')).toBeNull() // 行号从 1 起
    expect(parseCoord('A123')).toBeNull() // 行号超两位
    expect(parseCoord('A')).toBeNull() // 缺行号
    expect(parseCoord('12')).toBeNull() // 缺字母
  })
})

describe('formatCoord', () => {
  it('{ r: 4, c: 0 } -> "A5"', () => {
    expect(formatCoord({ r: 4, c: 0 })).toBe('A5')
  })

  it('{ r: 0, c: 0 } -> "A1"', () => {
    expect(formatCoord({ r: 0, c: 0 })).toBe('A1')
  })

  it('{ r: 25, c: 25 } -> "Z26"', () => {
    expect(formatCoord({ r: 25, c: 25 })).toBe('Z26')
  })

  it('往返一致', () => {
    const cells = [
      { r: 0, c: 0 },
      { r: 4, c: 0 },
      { r: 12, c: 9 },
      { r: 25, c: 25 },
      { r: 9, c: 15 },
    ]
    for (const cell of cells) {
      expect(parseCoord(formatCoord(cell))).toEqual(cell)
    }
  })
})
