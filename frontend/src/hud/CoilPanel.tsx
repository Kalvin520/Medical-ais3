// ============================================================
// CoilPanel — 控制器（線圈）監控（多廠區）
// 統一語意：線圈位元 true = 綠（通電 / 運轉允許 / 正常），
//           false = 紅（斷電 / 停機 / 異常）。燈號恆亮，以顏色表示狀態。
// ============================================================

import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile } from '../facilities/profiles'
import { Icon } from './Icon'

const GREEN = '#34d399'
const RED = '#fb4268'

export function CoilPanel() {
  const active = usePlantStore((s) => s.activeFacility)
  const st = usePlantStore((s) => s.statuses[s.activeFacility])
  const fac = getFacilityProfile(active)

  return (
    <div className="glass pad">
      <div className="panel-title">
        <Icon name="settings-2" size={15} /> 控制器 · COILS
      </div>
      <div className="coil-grid">
        {fac.coils.map((coil) => {
          const v = !!(st && st[coil.key])
          // 統一：true=綠(正常)、false=紅(停機/異常)
          const c = v ? GREEN : RED
          return (
            <div className="coil-cell" key={coil.key}>
              <span className="coil-lamp" style={{ background: c, boxShadow: `0 0 10px ${c}, 0 0 3px ${c}` }} />
              <span className="coil-name">{coil.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
