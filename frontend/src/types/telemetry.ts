// ============================================================
// 與 Go 後端 GenericFacility 狀態一一對應的型別契約
// 後端每 100ms 透過 WebSocket 廣播 { type:"status", facility, status }
// 各醫療設施皆為資料驅動（通道鍵 → 數值），故用通用 FacilityStatus。
// ============================================================

/** 設施故障 / 覆蓋層類型（資料驅動，後端 failureKey 字串即可） */
export type ExplosionType = string

/** 通用狀態占位（store.status 用；各設施實際遙測走 FacilityStatus） */
export interface PlantStatus {
  emergencyEnable: boolean
  isUnderAttack: boolean
  explosionType: ExplosionType | 'none'
  alertLevel: number
  alertMessage: string
}

export type SceneMode = 'realistic' | 'schematic'

/** 攻擊類型（資料驅動，字串即可，如 overinfuse / quench / unlockdoor） */
export type AttackType = 'all' | (string & {})

// ── 多廠區平台 ──
/** 設施清單項（來自後端 /api/config） */
export interface FacilityMeta {
  id: string
  name: string
  unitId: number
}

/** 通用設施狀態：各通道值 + 共同狀態欄位 */
export type FacilityStatus = Record<string, number | boolean> & {
  isUnderAttack: boolean
  explosionType: string
  alertLevel: number
  alertMessage: string
}

// ── WebSocket 訊息 ──
export type WsMessage =
  | { type: 'status'; facility?: string; status: PlantStatus & FacilityStatus }
  | { type: 'explosion'; explosionType: ExplosionType | 'none'; location?: string }
  | { type: 'alert'; level: number; message: string }

export interface BackendConfig {
  modbusPort: string
  modbusAddr: string
  facilities?: FacilityMeta[]
}

// ── 迷你虛擬醫院場域 ──
export type AppView = 'hospital' | 'device'

export type HospitalLevel = 'ok' | 'alarm' | 'offline'

export interface HospitalLink {
  label: string
  href: string
}

export interface HospitalFacility {
  id: string
  label: string
  zone: string
  ip: string
  online: boolean
  level: HospitalLevel
  detail: Record<string, unknown>
  links: HospitalLink[]
}

export interface HospitalSnapshot {
  ok: boolean
  summary: {
    online: number
    total: number
    cooling: string | null
    mri_status: string | null
  }
  facilities: HospitalFacility[]
  flows: {
    clinical: string[]
    cooling: string[]
  }
  links: Record<string, string>
}

// ── HUD 狀態物件 ──
export interface AlertItem {
  id: number
  time: string
  message: string
  level: number // 1-4
  icon?: string // lucide 圖示名
}

export interface Beacon {
  id: number
  type: ExplosionType
  position: [number, number, number]
  start: number
  duration: number
}

export interface ExplosionEvent {
  id: number
  type: ExplosionType
  position: [number, number, number]
  start: number
}

export interface AttackWarning {
  active: boolean
  target: string
  label: string
  sensor: string
  icon: string
  until: number
}

/** 預設狀態：後端離線時的通用占位值（各設施場景以自身預設值運作） */
export const DEFAULT_STATUS: PlantStatus = {
  emergencyEnable: true,
  isUnderAttack: false,
  explosionType: 'none',
  alertLevel: 0,
  alertMessage: '',
}
