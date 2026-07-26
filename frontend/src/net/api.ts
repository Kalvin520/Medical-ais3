// REST 呼叫 — 對應 Go 後端 /api/*（多廠區：以 facility 參數指定設施）
import type { AttackType, BackendConfig, HospitalSnapshot } from '../types/telemetry'

export async function fetchConfig(): Promise<BackendConfig | null> {
  try {
    const r = await fetch('/api/config')
    if (!r.ok) return null
    return (await r.json()) as BackendConfig
  } catch {
    return null
  }
}

/** 通知後端對指定設施寫入異常暫存器（真實性用途，前端仍會本地模擬以確保特效） */
export async function postAttack(type: AttackType, facility = 'infusion'): Promise<boolean> {
  try {
    const q = `type=${encodeURIComponent(type)}&facility=${encodeURIComponent(facility)}`
    const r = await fetch(`/api/attack?${q}`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

/** 重製指定設施的寄存器 / 線圈到預設值 */
export async function postReset(facility = 'infusion'): Promise<boolean> {
  try {
    const r = await fetch(`/api/reset?facility=${encodeURIComponent(facility)}`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}

export async function fetchHospitalSnapshot(): Promise<HospitalSnapshot | null> {
  try {
    const r = await fetch('/api/hospital/snapshot', { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as HospitalSnapshot
  } catch {
    return null
  }
}

export async function postHospitalReset(): Promise<boolean> {
  try {
    const r = await fetch('/api/hospital/reset', { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
}
