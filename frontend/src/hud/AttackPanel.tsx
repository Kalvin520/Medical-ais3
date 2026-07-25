// ============================================================
// 攻擊模擬控制台 — 依作用中設施列出攻擊序列（多廠區）
// 每個攻擊鈕對應該設施的一種攻擊類型 → 目標 → 故障/爆炸
// ============================================================

import { useState } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile } from '../facilities/profiles'
import { simulateAttack, resetPlant } from '../hooks/useTelemetryEffects'
import { Icon } from './Icon'

export function AttackPanel() {
  const [open, setOpen] = useState(true)
  const active = usePlantStore((s) => s.activeFacility)
  const fac = getFacilityProfile(active)

  return (
    <div className="glass pad">
      <div className="panel-title" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <Icon name="crosshair" size={15} /> 攻擊模擬 · ATTACK SIM
        <span className="spacer" />
        <Icon name="chevron-down" size={14} />
      </div>

      {open && (
        <div className="attack-body">
          <div className="attack-grid">
            {fac.attacks.map((a) => (
              <button
                key={a.type}
                className="btn btn-attack"
                onClick={() => simulateAttack(a.type)}
                title={`${a.label} → ${a.target}`}
              >
                <Icon name={a.icon} size={14} />
                <span className="atk-label">{a.label}</span>
                <span className="tail">{a.target}</span>
              </button>
            ))}
          </div>

          <button className="btn btn-attack critical" onClick={() => simulateAttack('all')}>
            <Icon name="radiation" size={14} /> 全面攻擊 — 全設施連鎖故障
          </button>

          <button className="btn btn-reset" onClick={() => resetPlant()}>
            <Icon name="rotate-ccw" size={14} /> 重製記憶體預設值
          </button>
        </div>
      )}
    </div>
  )
}
