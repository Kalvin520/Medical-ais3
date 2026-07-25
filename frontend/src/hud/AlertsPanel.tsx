// ============================================================
// 警報紀錄面板 — 反應式顯示 store 中的告警事件
// 依 level 著色左側邊框（lvl-2 警告 / lvl-3 / lvl-4 危險）
// ============================================================

import { usePlantStore } from '../store/usePlantStore'
import { Icon } from './Icon'

export function AlertsPanel() {
  const alerts = usePlantStore((s) => s.alerts)

  return (
    <div className="glass pad">
      <div className="panel-title">
        <Icon name="siren" size={15} /> 警報紀錄 · ALERTS
        <span className="spacer" />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--text-faint)' }}>
          {alerts.length}
        </span>
      </div>
      <div className="alerts-body">
        {alerts.map((a) => (
          <div
            key={a.id}
            className={'alert-item' + (a.level >= 4 ? ' lvl-4' : a.level === 3 ? ' lvl-3' : a.level === 2 ? ' lvl-2' : '')}
          >
            <Icon name={a.icon ?? 'signal-high'} size={13} />
            <span style={{ flex: 1 }}>
              <span className="ts">[{a.time}]</span> {a.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
