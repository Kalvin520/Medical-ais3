// ============================================================
// 左欄主面板 — 即時遙測儀表（多廠區：依作用中設施切換通道）
// 核心感測（攻擊目標）＋ 衍生遙測，以緊湊 2/3 欄網格呈現
// ============================================================

import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile } from '../facilities/profiles'
import { Gauge } from './Gauge'
import { Icon } from './Icon'

export function TelemetryPanel() {
  const active = usePlantStore((s) => s.activeFacility)
  const fac = getFacilityProfile(active)

  return (
    <div className="glass pad">
      <div className="panel-title">
        <Icon name="signal-high" size={15} /> 即時遙測 · TELEMETRY
      </div>

      <div className="tele-group-label">核心感測 · CORE（攻擊目標）</div>
      <div className="gauge-grid">
        {fac.core.map((d) => (
          <Gauge key={d.key as string} def={d} />
        ))}
      </div>

      <div className="tele-group-label">衍生遙測 · DERIVED</div>
      <div className="gauge-grid cols-3">
        {fac.derived.map((d) => (
          <Gauge key={d.key as string} def={d} compact />
        ))}
      </div>
    </div>
  )
}
