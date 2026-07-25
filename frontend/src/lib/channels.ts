// ============================================================
// 遙測通道中繼資料 — 驅動 HUD 儀表與設備浮動標籤
// ============================================================

export type ChannelState = 'normal' | 'warning' | 'danger'

export interface ChannelDef {
  key: string // 通道 JSON 鍵（多廠區：對應作用中設施的 FacilityStatus 鍵）
  label: string
  unit: string
  icon: string // lucide-react 圖示名
  reg?: string // (已停用顯示；CTF 靶場不洩漏 Modbus 位址)
  min: number
  max: number
  decimals: number
  warning?: number // 高側警告閾值
  danger?: number // 高側危險閾值
  lowWarning?: number // 低側警告閾值
  lowDanger?: number // 低側危險閾值
  targetHint?: string // 核心通道：攻擊後果提示
}

/** 依數值判定通道狀態（兼顧高側與低側閾值） */
export function channelState(def: ChannelDef, value: number): ChannelState {
  if (def.danger !== undefined && value >= def.danger) return 'danger'
  if (def.lowDanger !== undefined && value <= def.lowDanger) return 'danger'
  if (def.warning !== undefined && value >= def.warning) return 'warning'
  if (def.lowWarning !== undefined && value <= def.lowWarning) return 'warning'
  return 'normal'
}

/** 格式化顯示值 */
export function formatValue(def: ChannelDef, value: number): string {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(def.decimals)
}

/** 0-100 的填充百分比 */
export function fillPercent(def: ChannelDef, value: number): number {
  const p = ((value - def.min) / (def.max - def.min)) * 100
  return Math.max(0, Math.min(100, p))
}
