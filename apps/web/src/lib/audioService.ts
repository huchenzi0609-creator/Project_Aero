/**
 * audioService —— 音效占位接口（M7 以 Web Audio 实现）。
 * M4 阶段全部方法为 no-op 存根：对局流程在此处调用（报点/盖章/翻页），
 * M7 只需把同名方法替换为真实实现 + 接 settingsStore 双推杆即可，调用方无需改动。
 */
export type SfxName = 'shoot' | 'stamp' | 'page-flip' | 'preview'

export const audioService = {
  /** 首次用户交互时解锁 Web Audio 上下文（M7 实现） */
  unlock(): void {},
  playSfx(_name: SfxName): void {},
  playBgm(): void {},
  stopBgm(): void {},
  setBgmVolume(_v: number): void {},
  setSfxVolume(_v: number): void {},
}
