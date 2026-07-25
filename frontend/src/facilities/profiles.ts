// ============================================================
// 前端設施註冊表（醫療設備教學靶機）— 每台設備的遙測通道、控制線圈、攻擊與故障對應。
// 與後端 simulator profiles（Modbus 暫存器映射）一一對齊。資料驅動定義。
//
//   infusion  輸液幫浦病房  Unit 1
//   mri       核磁共振 MRI  Unit 2
// ============================================================

import type { ChannelDef } from '../lib/channels'

export interface FacilityAttack {
  type: string // 後端 attack type
  label: string
  target: string
  icon: string
}

export interface FacilityCoil {
  key: string
  reg: string
  name: string
}

export interface FacilityProfile {
  id: string
  name: string
  icon: string // 設施切換器圖示
  core: ChannelDef[] // 攻擊標的（可寫）
  derived: ChannelDef[] // 衍生唯讀遙測
  coils: FacilityCoil[]
  attacks: FacilityAttack[]
  /** 後端 explosionType / failureKey → 螢幕中央故障覆蓋訊息 */
  failureMessages: Record<string, string>
}

// ── 輸液幫浦病房 IV Infusion Pump ──
const INFUSION: FacilityProfile = {
  id: 'infusion',
  name: '輸液幫浦病房',
  icon: 'droplet',
  core: [
    { key: 'flowRate', label: '輸注速率', unit: 'mL/h', icon: 'droplet', min: 0, max: 1200, decimals: 0, warning: 400, danger: 600, targetHint: '超速 → 藥物過量' },
    { key: 'drugConc', label: '藥物濃度', unit: 'mg/mL', icon: 'flask-conical', min: 0, max: 20, decimals: 2, warning: 5, danger: 8, targetHint: '濃度過高 → 劑量危險' },
    { key: 'occlusionLimit', label: '阻塞警報閾值', unit: 'bar', icon: 'bell', min: 0, max: 10, decimals: 2, warning: 6, danger: 8, targetHint: '調高 → 遮蔽阻塞警報' },
  ],
  derived: [
    { key: 'deliveredVolume', label: '累計輸注量', unit: 'mL', icon: 'cylinder', min: 0, max: 2000, decimals: 0 },
    { key: 'linePressure', label: '管路壓力', unit: 'bar', icon: 'gauge', min: 0, max: 8, decimals: 2, warning: 3, danger: 5 },
    { key: 'dropRate', label: '滴速', unit: 'drops/min', icon: 'droplets', min: 0, max: 400, decimals: 0 },
    { key: 'reservoirLevel', label: '藥袋餘量', unit: '%', icon: 'battery', min: 0, max: 100, decimals: 0, lowWarning: 20, lowDanger: 8 },
    { key: 'doseRateBody', label: '每公斤劑量', unit: 'mg/kg/h', icon: 'activity', min: 0, max: 20, decimals: 2, warning: 5, danger: 8 },
    { key: 'batteryLevel', label: '電池電量', unit: '%', icon: 'battery-charging', min: 0, max: 100, decimals: 0, lowWarning: 20, lowDanger: 10 },
    { key: 'airInLine', label: '管路空氣', unit: 'µL', icon: 'wind', min: 0, max: 200, decimals: 0, warning: 30, danger: 50 },
  ],
  coils: [
    { key: 'emergencyEnable', reg: 'Coil0', name: '運轉允許' },
    { key: 'pumpRun', reg: 'Coil1', name: '幫浦運轉' },
    { key: 'alarmSilence', reg: 'Coil2', name: '警報靜音' },
  ],
  attacks: [
    { type: 'overinfuse', label: '超速輸注', target: '輸注管路', icon: 'droplet' },
    { type: 'overconc', label: '濃度竄改', target: '藥物濃度', icon: 'flask-conical' },
    { type: 'hidealarm', label: '遮蔽警報', target: '警報系統', icon: 'bell-off' },
  ],
  failureMessages: {
    overdose: '藥物過量\n每公斤劑量超出臨界',
    occlusion: '管路阻塞\n管路壓力超出臨界',
    airembolism: '空氣栓塞\n管路混入空氣',
  },
}

// ── 核磁共振 MRI（周邊安全 PLC：磁體冷卻/液氦/梯度/射頻/門禁互鎖） ──
const MRI: FacilityProfile = {
  id: 'mri',
  name: '核磁共振 MRI',
  icon: 'scan',
  core: [
    { key: 'coolingFlow', label: '磁體冷卻流量', unit: 'L/min', icon: 'snowflake', min: 0, max: 100, decimals: 1, lowWarning: 30, lowDanger: 15, targetHint: '過低 → 磁體失超' },
    { key: 'rfPower', label: '射頻功率', unit: '%', icon: 'radio', min: 0, max: 250, decimals: 0, warning: 130, danger: 150, targetHint: '過高 → SAR 灼傷' },
    { key: 'gradientDuty', label: '梯度線圈負載', unit: '%', icon: 'activity', min: 0, max: 160, decimals: 0, warning: 100, danger: 120, targetHint: '過高 → 線圈過熱' },
  ],
  derived: [
    { key: 'magnetTemp', label: '磁體溫度', unit: 'K', icon: 'thermometer', min: 0, max: 20, decimals: 2, warning: 5, danger: 6 },
    { key: 'heliumLevel', label: '液氦液位', unit: '%', icon: 'cylinder', min: 0, max: 100, decimals: 0, lowWarning: 60, lowDanger: 40 },
    { key: 'sarValue', label: '比吸收率 SAR', unit: 'W/kg', icon: 'radiation', min: 0, max: 12, decimals: 2, warning: 2, danger: 4 },
    { key: 'gradientTemp', label: '梯度線圈溫度', unit: '°C', icon: 'flame', min: 0, max: 120, decimals: 0, warning: 60, danger: 80 },
    { key: 'boreTemp', label: '孔徑溫度', unit: '°C', icon: 'thermometer-sun', min: 0, max: 60, decimals: 1, warning: 35, danger: 40 },
    { key: 'quenchPressure', label: '失超排氣壓', unit: 'bar', icon: 'wind', min: 0, max: 20, decimals: 2, warning: 1, danger: 3 },
    { key: 'fieldStrength', label: '磁場強度', unit: 'T', icon: 'magnet', min: 0, max: 3.5, decimals: 2, lowWarning: 2, lowDanger: 1 },
    { key: 'doorBreach', label: '門禁狀態', unit: '', icon: 'door-open', min: 0, max: 1, decimals: 0, warning: 0.5, danger: 0.5 },
  ],
  coils: [
    { key: 'emergencyEnable', reg: 'Coil0', name: '運轉允許' },
    { key: 'cryoCoolerRun', reg: 'Coil1', name: '冷卻機' },
    { key: 'doorInterlock', reg: 'Coil2', name: '門禁互鎖' },
  ],
  attacks: [
    { type: 'stopcooling', label: '停止冷卻', target: '磁體冷卻', icon: 'snowflake' },
    { type: 'overrf', label: '射頻超標', target: '射頻系統', icon: 'radio' },
    { type: 'unlockdoor', label: '解除門禁', target: '門禁互鎖', icon: 'door-open' },
  ],
  failureMessages: {
    quench: '磁體失超 Quench\n磁體溫度超出臨界',
    sarburn: 'SAR 超標\n射頻能量沉積過量',
    projectile: '鐵磁投射物危害\n門禁互鎖失效',
  },
}

export const FACILITY_PROFILES: Record<string, FacilityProfile> = {
  infusion: INFUSION,
  mri: MRI,
}

export const FACILITY_ORDER = ['infusion', 'mri']

export function getFacilityProfile(id: string): FacilityProfile {
  return FACILITY_PROFILES[id] ?? INFUSION
}
