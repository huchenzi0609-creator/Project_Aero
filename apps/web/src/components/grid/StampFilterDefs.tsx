/**
 * 全局盖章滤镜定义（单实例，避免 ID 冲突）。
 * stamp-rough：feTurbulence + feDisplacementMap 让边缘轻微不规则
 * stamp-blur：墨迹晕染
 */
export function StampFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="stamp-rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="stamp-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
    </svg>
  )
}
