/**
 * audioService —— M7 音效（Web Audio API，全部程序合成，无外部音频文件）。
 *
 * 设计要点：
 * - AudioContext 惰性创建；首次用户交互（unlock，pointerdown/keydown）resume，
 *   规避移动端自动播放限制；resume 失败/环境不支持时静默降级为 no-op。
 * - 音效：铅笔沙沙（报点）、盖章（结果）、重章+纸裂（击毁）、纸张翻动（切页）、
 *   胜负小旋律（win/lose）；均为振荡器+噪声包络程序合成。
 * - 音量：接 settingsStore 的 sfxVolume（读值即可，无需响应式订阅）；静音（0）跳过播放。
 * - v0.3.9：移除常驻背景噪音（bgm 循环/噪声垫）——bgmVolume 字段保留（存档兼容）但不再播放；
 *   playBgm/stopBgm/setBgmVolume 保留为空实现，兼容旧调用方。
 */
import { useSettingsStore } from '../store/settingsStore'

export type SfxName = 'shoot' | 'stamp' | 'kill' | 'page-flip' | 'preview' | 'win' | 'lose' | 'success' | 'failure'

/* ---------------------------------------------------------------- 上下文与开关 */

type Ctx = AudioContext

let ctx: Ctx | null = null
let noiseBuf: AudioBuffer | null = null
let disabled = false

function createCtx(): Ctx | null {
  if (typeof window === 'undefined') return null
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  } catch {
    disabled = true
    ctx = null
  }
  return ctx
}

function ensureCtx(): Ctx | null {
  if (disabled) return null
  return ctx ?? createCtx()
}

/** 首次用户交互时调用：创建并 resume 上下文（BGM 已移除，不再启动背景噪音） */
export function unlock(): void {
  const c = ensureCtx()
  if (!c) return
  if (c.state === 'suspended') {
    c.resume().catch(() => {
      /* 自动播放策略拒绝：保持静默，后续交互会再次尝试 */
    })
  }
}

/* ---------------------------------------------------------------- 合成工具 */

function noiseSource(c: Ctx): AudioBufferSourceNode {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 2)
    noiseBuf = c.createBuffer(1, len, c.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  return src
}

interface EnvOpts {
  peak: number
  attack: number
  decay: number
  /** 起音时间（s，相对 now） */
  at?: number
}

/** 创建包络增益：0 → peak（attack）→ ~0（decay），挂到 dest 并返回 */
function env(c: Ctx, dest: AudioNode, opts: EnvOpts): GainNode {
  const g = c.createGain()
  const t0 = c.currentTime + (opts.at ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(opts.peak, t0 + opts.attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.attack + opts.decay)
  g.connect(dest)
  return g
}

function sfxDest(): AudioNode | null {
  const c = ensureCtx()
  if (!c) return null
  if (useSettingsStore.getState().sfxVolume <= 0) return null
  const g = c.createGain()
  g.gain.value = useSettingsStore.getState().sfxVolume
  g.connect(c.destination)
  return g
}

/** 白噪声短音（经滤波），返回其包络终点时间 */
function noiseBlip(
  c: Ctx,
  dest: AudioNode,
  o: {
    type?: BiquadFilterType
    freq: number
    freqEnd?: number
    q?: number
    peak: number
    attack: number
    decay: number
    at?: number
  },
): void {
  const src = noiseSource(c)
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.value = o.freq
  f.Q.value = o.q ?? 0.8
  if (o.freqEnd !== undefined) {
    const t0 = c.currentTime + (o.at ?? 0)
    f.frequency.setValueAtTime(o.freq, t0)
    f.frequency.linearRampToValueAtTime(o.freqEnd, t0 + o.decay)
  }
  const g = env(c, dest, { peak: o.peak, attack: o.attack, decay: o.decay, at: o.at })
  src.connect(f)
  f.connect(g)
  const t0 = c.currentTime + (o.at ?? 0)
  src.start(t0)
  src.stop(t0 + o.attack + o.decay + 0.05)
}

/** 正弦/三角单音（低频咚/旋律音符） */
function tone(
  c: Ctx,
  dest: AudioNode,
  o: { freq: number; type?: OscillatorType; peak: number; attack: number; decay: number; at?: number },
): void {
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.value = o.freq
  const g = env(c, dest, { peak: o.peak, attack: o.attack, decay: o.decay, at: o.at })
  osc.connect(g)
  const t0 = c.currentTime + (o.at ?? 0)
  osc.start(t0)
  osc.stop(t0 + o.attack + o.decay + 0.05)
}

/* ---------------------------------------------------------------- 音效 */

function playShoot(c: Ctx, dest: AudioNode): void {
  noiseBlip(c, dest, { type: 'bandpass', freq: 3000, freqEnd: 1300, q: 1.2, peak: 0.5, attack: 0.004, decay: 0.16 })
  // 沙沙的二次轻刮
  noiseBlip(c, dest, { type: 'bandpass', freq: 2200, freqEnd: 1600, q: 2, peak: 0.22, attack: 0.004, decay: 0.09, at: 0.06 })
}

function playStamp(c: Ctx, dest: AudioNode): void {
  tone(c, dest, { freq: 160, peak: 0.55, attack: 0.002, decay: 0.09 })
  noiseBlip(c, dest, { type: 'lowpass', freq: 900, q: 0.6, peak: 0.34, attack: 0.002, decay: 0.12 })
}

function playKill(c: Ctx, dest: AudioNode): void {
  // 重章：低频双咚
  tone(c, dest, { freq: 120, peak: 0.62, attack: 0.002, decay: 0.18 })
  tone(c, dest, { freq: 90, peak: 0.4, attack: 0.002, decay: 0.13, at: 0.12 })
  // 纸张碎裂：高频噪声下扫
  noiseBlip(c, dest, { type: 'lowpass', freq: 4200, freqEnd: 280, q: 0.5, peak: 0.5, attack: 0.004, decay: 0.42 })
}

function playPageFlip(c: Ctx, dest: AudioNode): void {
  noiseBlip(c, dest, { type: 'bandpass', freq: 600, freqEnd: 2400, q: 0.9, peak: 0.38, attack: 0.006, decay: 0.16 })
  noiseBlip(c, dest, { type: 'bandpass', freq: 2400, freqEnd: 900, q: 1.1, peak: 0.24, attack: 0.006, decay: 0.12, at: 0.14 })
}

function playWin(c: Ctx, dest: AudioNode): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) =>
    tone(c, dest, { freq: f, type: 'triangle', peak: 0.24, attack: 0.008, decay: 0.16, at: i * 0.11 }),
  )
}

function playLose(c: Ctx, dest: AudioNode): void {
  const notes = [392.0, 329.63, 261.63]
  notes.forEach((f, i) =>
    tone(c, dest, { freq: f, type: 'triangle', peak: 0.2, attack: 0.01, decay: 0.24, at: i * 0.18 }),
  )
}

/** v0.3.13 教程正反馈：两声清脆升调短铃（明亮、多邻国式） */
function playSuccess(c: Ctx, dest: AudioNode): void {
  tone(c, dest, { freq: 783.99, type: 'triangle', peak: 0.34, attack: 0.003, decay: 0.10 })
  tone(c, dest, { freq: 1174.66, type: 'triangle', peak: 0.3, attack: 0.003, decay: 0.16, at: 0.09 })
  // 轻微高频泛音点缀，增加“清脆”质感
  tone(c, dest, { freq: 2349.32, type: 'sine', peak: 0.09, attack: 0.002, decay: 0.08, at: 0.09 })
}

/** v0.3.13 教程负反馈：两声沉闷低频下行短音 */
function playFailure(c: Ctx, dest: AudioNode): void {
  tone(c, dest, { freq: 196.0, type: 'sine', peak: 0.42, attack: 0.004, decay: 0.15 })
  tone(c, dest, { freq: 146.83, type: 'sine', peak: 0.4, attack: 0.004, decay: 0.2, at: 0.13 })
  // 低通闷响：让两声更“沉”
  noiseBlip(c, dest, { type: 'lowpass', freq: 300, q: 0.6, peak: 0.2, attack: 0.003, decay: 0.14 })
  noiseBlip(c, dest, { type: 'lowpass', freq: 240, q: 0.6, peak: 0.16, attack: 0.003, decay: 0.18, at: 0.13 })
}

function playPreview(c: Ctx, dest: AudioNode): void {
  // 试听：翻页 + 盖章 + 一个暖音
  playPageFlip(c, dest)
  playStamp(c, dest)
  tone(c, dest, { freq: 523.25, type: 'triangle', peak: 0.2, attack: 0.01, decay: 0.2, at: 0.22 })
}

const SFX_PLAYERS: Record<SfxName, (c: Ctx, dest: AudioNode) => void> = {
  shoot: playShoot,
  stamp: playStamp,
  kill: playKill,
  'page-flip': playPageFlip,
  preview: playPreview,
  win: playWin,
  lose: playLose,
  success: playSuccess,
  failure: playFailure,
}

export function playSfx(name: SfxName): void {
  const c = ensureCtx()
  const dest = sfxDest()
  if (!c || !dest) return
  SFX_PLAYERS[name](c, dest)
}

/* ---------------------------------------------------------------- BGM（v0.3.9：已移除背景噪音） */

/** 背景噪音循环已彻底移除；playBgm 保留为空实现以兼容旧调用方（不再有任何音频节点） */
export function playBgm(): void {
  /* no-op：v0.3.9 起不再播放背景噪音 */
}

export function stopBgm(): void {
  /* no-op：已无 bgm 节点可停 */
}

/* ---------------------------------------------------------------- 音量 */

export function setBgmVolume(_v: number): void {
  /* no-op：bgm 已移除；settingsStore.bgmVolume 字段保留（存档结构兼容），不再消费 */
}

export function setSfxVolume(_v: number): void {
  // 音效音量在每次 playSfx 时读取 settingsStore 实时值，无需缓存节点
}

/** 兼容旧调用方的聚合对象（M4 起页面均通过 audioService.xxx 调用） */
export const audioService = {
  unlock,
  playSfx,
  playBgm,
  stopBgm,
  setBgmVolume,
  setSfxVolume,
}
