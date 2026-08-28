/**
 * 坐标展示辅助：列字母（A 起）。
 * 解析/格式化统一走 @aero/game-core 的 parseCoord / formatCoord（契约见 docs/game-core-api.md）。
 */
export function colLetter(c: number): string {
  return String.fromCharCode(65 + c)
}
