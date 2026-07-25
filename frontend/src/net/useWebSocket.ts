// ============================================================
// WebSocket 連線 hook — 連到後端 /ws，將遙測 / 警報 / 爆炸寫入 store
// 具自動重連；後端離線時 UI 仍以預設值運作。
// ============================================================

import { useEffect, useRef } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import type { WsMessage } from '../types/telemetry'

export function useWebSocket() {
  const triedRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false
    const store = usePlantStore.getState

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${location.host}/ws`
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        triedRef.current = 0
        store().setConnected(true)
        store().addAlert('WebSocket 遙測串流已連線', 1, 'radio-tower')
      }

      ws.onmessage = (ev) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        const s = store()
        if (msg.type === 'status') {
          // 多設施：依 facility 分流存放（未帶 facility 視為輸液幫浦病房）
          s.setStatusFor(msg.facility ?? 'infusion', msg.status)
        } else if (msg.type === 'alert') {
          s.addAlert(msg.message, msg.level)
        } else if (msg.type === 'explosion') {
          // 醫療靶機的故障視覺由各設施場景依 status.explosionType 自行呈現；
          // 此處僅在後端另行推送 explosion 事件時寫入警報紀錄。
          if (msg.explosionType && msg.explosionType !== 'none') {
            s.addAlert(`後端偵測設備故障：${msg.explosionType}`, 4, 'flame')
          }
        }
      }

      ws.onclose = () => {
        store().setConnected(false)
        if (!closedRef.current) scheduleReconnect()
      }
      ws.onerror = () => ws.close()
    }

    function scheduleReconnect() {
      if (closedRef.current) return
      triedRef.current = Math.min(triedRef.current + 1, 6)
      const delay = 1500 * triedRef.current
      window.setTimeout(() => {
        if (!closedRef.current) connect()
      }, delay)
    }

    connect()
    return () => {
      closedRef.current = true
      wsRef.current?.close()
    }
  }, [])
}
