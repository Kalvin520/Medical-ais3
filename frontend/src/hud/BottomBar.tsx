// 底列控制條 — 作用中設施的控制線圈 (Coil0-2) + Modbus 連線資訊（多廠區）
import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile } from '../facilities/profiles'
import { Icon } from './Icon'

// 線圈 → 底列圖示
const COIL_ICON: Record<string, string> = {
  emergencyEnable: 'octagon-x',
  coolingPump: 'droplets',
  mainValve: 'settings-2',
  mainConveyor: 'waypoints',
  diverter: 'settings-2',
  mainPump: 'droplets',
  aerator: 'wind',
  craneEnable: 'building-2',
  conveyorRun: 'waves',
  traction: 'power',
  signalGreen: 'radio-tower',
  switchNormal: 'waypoints',
}

export function BottomBar() {
  const active = usePlantStore((s) => s.activeFacility)
  const st = usePlantStore((s) => s.statuses[s.activeFacility])
  const config = usePlantStore((s) => s.config)
  const fac = getFacilityProfile(active)

  const modbusText = config
    ? 'Modbus: ' + location.hostname + ':' + config.modbusPort
    : 'Modbus: 後端離線'

  return (
    <div className="bottombar">
      {fac.coils.map((coil) => {
        const v = !!(st && st[coil.key])
        // 統一：true = ON(綠/正常)、false = OFF(紅/異常)
        const on = v
        const alarm = !v
        const state = v ? 'ON' : 'OFF'
        return (
          <div
            key={coil.key}
            className={'status-chip' + (on ? ' on' : '') + (alarm ? ' alarm' : '')}
          >
            <span className="ic">
              <Icon name={COIL_ICON[coil.key] ?? 'settings-2'} size={15} />
            </span>
            <span>{coil.name}</span>
            <span className="chip-state">{state}</span>
          </div>
        )
      })}

      <div className={'status-chip' + (config ? ' on' : '')}>
        <span className="ic">
          <Icon name="radio-tower" size={15} />
        </span>
        <span>{modbusText}</span>
      </div>
    </div>
  )
}
