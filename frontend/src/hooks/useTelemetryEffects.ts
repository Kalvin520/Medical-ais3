// ============================================================
// 攻擊編排（多廠區）— 攻擊只對後端注入異常參數，後果完全由物理/場景呈現：
// 不再有前端假倒數與警告彈出視窗；設施由後端 explosionType 驅動場景效果。
// 另負責載入 /api/config（含設施清單）。
// ============================================================

import { useEffect } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import { fetchConfig, postAttack, postReset } from '../net/api'
import { getFacilityProfile } from '../facilities/profiles'
import type { AttackType } from '../types/telemetry'

/** 由 HUD 攻擊面板呼叫：直接對後端注入異常參數（無倒數、無警告視窗）。
 *  後果交給物理/場景呈現——例如輸液過量、管路阻塞、MRI 失超。 */
export function simulateAttack(type: AttackType) {
  const s = usePlantStore.getState()
  const facility = s.activeFacility
  const prof = getFacilityProfile(facility)

  if (type === 'all') {
    s.addAlert('全面攻擊：對全設施感測器注入異常值', 4, 'radiation')
  } else {
    const atk = prof.attacks.find((a) => a.type === type)
    if (atk) s.addAlert(`觸發攻擊：${atk.label} → ${atk.target}`, 3, atk.icon)
  }

  void postAttack(type, facility)
}

/** 重製目前設施的寄存器 / 線圈 */
export async function resetPlant() {
  const facility = usePlantStore.getState().activeFacility
  const ok = await postReset(facility)
  const s = usePlantStore.getState()
  if (ok) s.addAlert('已重製記憶體預設值，可重新進行攻擊測試', 1, 'check')
  else s.addAlert('重製失敗，請確認後端服務在線', 3, 'x')
}

/** 掛載於 App：載入後端設定（含設施清單）+ 危險自動引爆/警報 */
export function useTelemetryEffects() {
  useEffect(() => {
    fetchConfig().then((c) => {
      if (!c) return
      const s = usePlantStore.getState()
      s.setConfig(c)
      if (c.facilities && c.facilities.length) s.setFacilities(c.facilities)
    })
  }, [])

  // 設施故障：後端 explosionType 由 none → 故障時，寫入警報紀錄（視覺效果由場景自行呈現）
  useEffect(() => {
    const seen: Record<string, string> = {}

    const unsub = usePlantStore.subscribe((state) => {
      const fac = state.activeFacility
      const st = state.statuses[fac]
      if (!st) return
      const et = String(st.explosionType ?? 'none')
      if (et !== 'none' && seen[fac] !== et) {
        seen[fac] = et
        const prof = getFacilityProfile(fac)
        const msg = prof.failureMessages[et] ?? `${prof.name}故障`
        window.setTimeout(() => usePlantStore.getState().addAlert(msg.replace('\n', '：'), 4, 'radiation'), 0)
      } else if (et === 'none') {
        seen[fac] = 'none'
      }
    })

    return unsub
  }, [])
}
