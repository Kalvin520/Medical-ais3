// ============================================================
// Gauge — 單一遙測讀數卡（HUD）
// 從 store 讀取通道數值，依閾值上色。
//   完整版（核心感測）：圖示 + 數值 + 細填充條 + 危險刻度
//   緊湊版（衍生遙測 compact）：圖示 + 數值，3 欄密排，省空間
// 攻擊後果提示（targetHint）移至 hover tooltip，避免畫面雜亂。
// ============================================================

import { usePlantStore } from '../store/usePlantStore'
import { channelState, fillPercent, formatValue, type ChannelDef } from '../lib/channels'
import { Icon } from './Icon'

export function Gauge({ def, compact = false }: { def: ChannelDef; compact?: boolean }) {
  // 讀取目前作用中設施的對應通道值（多廠區）
  const value = usePlantStore((s) => {
    const st = s.statuses[s.activeFacility]
    const v = st ? st[def.key as string] : undefined
    return typeof v === 'number' ? v : 0
  })

  const state = channelState(def, value)
  // normal 時用空字串，避免多餘的尾隨空白 class
  const stateClass = state === 'normal' ? '' : ` ${state}`
  const span = def.max - def.min

  return (
    <div
      className={`gauge${compact ? ' compact' : ''}${stateClass}`}
      title={def.label}
    >
      <div className="gauge-top">
        <Icon name={def.icon} size={compact ? 11 : 12} />
        <span className="gauge-label">{def.label}</span>
      </div>
      <div className={`gauge-value${stateClass}`}>
        {formatValue(def, value)}
        <span className="unit">{def.unit}</span>
      </div>
      {!compact && (
        <div className="gauge-track">
          <div
            className={`gauge-fill${stateClass}`}
            style={{ width: `${fillPercent(def, value)}%` }}
          />
          {def.danger != null && span > 0 && (
            <div
              className="gauge-tick"
              style={{ left: `${((def.danger - def.min) / span) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  )
}
