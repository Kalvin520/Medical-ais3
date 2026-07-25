// HUD 容器 — 組合頂列、左右側欄、底列與覆蓋層
import { TopBar } from './TopBar'
import { BottomBar } from './BottomBar'
import { TelemetryPanel } from './TelemetryPanel'
import { CoilPanel } from './CoilPanel'
import { AlertsPanel } from './AlertsPanel'
import { AttackPanel } from './AttackPanel'

export function Hud() {
  return (
    <div className="hud-root">
      <TopBar />

      <div className="rail left">
        <TelemetryPanel />
        <CoilPanel />
      </div>

      <div className="rail right">
        <AlertsPanel />
        <AttackPanel />
      </div>

      <BottomBar />

      {/* 素材出處（地面貼圖 Poly Haven CC0；3D 設備皆為程序化幾何） */}
      <div className="credits">
        醫療設備教學靶機 · AIS3 跨域3 · 地面貼圖 Poly Haven (CC0)
      </div>
    </div>
  )
}
