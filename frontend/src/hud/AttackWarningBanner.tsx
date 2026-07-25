// ============================================================
// 攻擊倒數警示橫幅 — 鎖定目標感測器後，倒數至爆炸的紅色臨界提示
// 資料來源：usePlantStore.attackWarning（AttackWarning | null）
// ============================================================

import { useEffect, useState } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import { Icon } from './Icon'

export function AttackWarningBanner() {
  const w = usePlantStore((s) => s.attackWarning)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!w) {
      setRemaining(0)
      return
    }

    const tick = () => {
      const left = Math.max(0, Math.ceil((w.until - Date.now()) / 1000))
      setRemaining(left)
      return left
    }

    // 立即同步一次，避免首幀顯示舊值
    if (tick() <= 0) return

    const id = window.setInterval(() => {
      if (tick() <= 0) window.clearInterval(id)
    }, 250)

    return () => window.clearInterval(id)
  }, [w])

  if (!w) return null

  return (
    <div className="attack-warning">
      <div className="aw-kicker">CRITICAL SENSOR ALERT</div>
      <div className="aw-target" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon name={w.icon} size={20} /> {w.target} — {w.label} ({w.sensor}) 超出臨界
      </div>
      <div className="aw-count">
        <span>鎖定倒數</span>
        <span className="aw-timer">{remaining}</span>
        <span>秒後爆炸</span>
      </div>
    </div>
  )
}
