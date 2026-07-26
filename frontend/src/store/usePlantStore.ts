// ============================================================
// 全域狀態 (zustand) — 遙測、警報、鎖定光環、爆炸事件、覆蓋層
// ============================================================

import { create } from 'zustand'
import {
  DEFAULT_STATUS,
  type AlertItem,
  type AttackWarning,
  type BackendConfig,
  type Beacon,
  type ExplosionEvent,
  type ExplosionType,
  type FacilityMeta,
  type FacilityStatus,
  type AppView,
  type HospitalSnapshot,
  type PlantStatus,
  type SceneMode,
} from '../types/telemetry'
// 通用故障覆蓋層訊息（醫療靶機以 triggerFailure 帶入設施專屬訊息）
const FAILURE_OVERLAY = '偵測到設備故障'

let seq = 0
const nextId = () => ++seq

const MAX_ALERTS = 12
const EXPLOSION_TTL = 7000

interface BoomOverlay {
  id: number
  type: ExplosionType
  message: string
}

interface PlantState {
  status: PlantStatus
  connected: boolean
  config: BackendConfig | null
  alerts: AlertItem[]
  beacons: Beacon[]
  explosions: ExplosionEvent[]
  attackWarning: AttackWarning | null
  boom: BoomOverlay | null
  dayMode: boolean
  sceneMode: SceneMode
  appView: AppView
  hospitalSnapshot: HospitalSnapshot | null
  hospitalConnected: boolean
  selectedHospitalFacility: string | null

  // ── 多廠區平台 ──
  facilities: FacilityMeta[]
  activeFacility: string
  statuses: Record<string, FacilityStatus>

  setStatus: (s: PlantStatus) => void
  setStatusFor: (facility: string, status: FacilityStatus) => void
  setFacilities: (f: FacilityMeta[]) => void
  setActiveFacility: (id: string) => void
  setConnected: (c: boolean) => void
  setConfig: (c: BackendConfig) => void
  addAlert: (message: string, level?: number, icon?: string) => void
  addBeacon: (type: ExplosionType, position: [number, number, number], duration?: number) => number
  removeBeacon: (id: number) => void
  spawnExplosion: (type: ExplosionType, position: [number, number, number]) => void
  clearExplosion: (id: number) => void
  triggerFailure: (message: string) => void
  setAttackWarning: (w: AttackWarning | null) => void
  toggleDay: () => void
  toggleScene: () => void
  setScene: (m: SceneMode) => void
  setAppView: (view: AppView) => void
  setHospitalSnapshot: (snapshot: HospitalSnapshot | null) => void
  setHospitalConnected: (connected: boolean) => void
  setSelectedHospitalFacility: (id: string | null) => void
}

function timeStr(): string {
  const d = new Date()
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export const usePlantStore = create<PlantState>((set, get) => ({
  status: DEFAULT_STATUS,
  connected: false,
  config: null,
  alerts: [{ id: nextId(), time: timeStr(), message: '系統啟動，等待遙測串流…', level: 1, icon: 'power' }],
  beacons: [],
  explosions: [],
  attackWarning: null,
  boom: null,
  dayMode: true,
  sceneMode: 'realistic',
  appView: 'hospital',
  hospitalSnapshot: null,
  hospitalConnected: false,
  selectedHospitalFacility: 'mri-sim',

  facilities: [],
  activeFacility: 'infusion',
  statuses: {},

  setStatus: (s) => set({ status: s }),

  // 各設施狀態依 facility 分流存放
  setStatusFor: (facility, status) =>
    set((st) => ({ statuses: { ...st.statuses, [facility]: status } })),

  setFacilities: (f) => set({ facilities: f }),

  // 切換設施：清掉跨設施殘留的鎖定光環/警示/故障覆蓋
  setActiveFacility: (id) =>
    set({
      activeFacility: id,
      beacons: [],
      explosions: [],
      attackWarning: null,
      boom: null,
    }),

  setConnected: (c) => set({ connected: c }),
  setConfig: (c) => set({ config: c }),

  addAlert: (message, level = 1, icon) =>
    set((st) => ({
      alerts: [{ id: nextId(), time: timeStr(), message, level, icon }, ...st.alerts].slice(0, MAX_ALERTS),
    })),

  addBeacon: (type, position, duration = 3000) => {
    const id = nextId()
    set((st) => ({ beacons: [...st.beacons, { id, type, position, start: Date.now(), duration }] }))
    return id
  },
  removeBeacon: (id) => set((st) => ({ beacons: st.beacons.filter((b) => b.id !== id) })),

  spawnExplosion: (type, position) => {
    const id = nextId()
    set((st) => ({
      explosions: [...st.explosions, { id, type, position, start: Date.now() }],
      boom: { id, type, message: FAILURE_OVERLAY },
    }))
    // 覆蓋層訊息與爆炸事件分別自動清除
    window.setTimeout(() => {
      const cur = get().boom
      if (cur && cur.id === id) set({ boom: null })
    }, 2600)
    window.setTimeout(() => get().clearExplosion(id), EXPLOSION_TTL)
  },
  clearExplosion: (id) => set((st) => ({ explosions: st.explosions.filter((e) => e.id !== id) })),

  // 通用設施故障：僅顯示螢幕中央爆炸覆蓋訊息（無 3D 爆炸，供尚無專屬場景的設施）
  triggerFailure: (message) => {
    const id = nextId()
    set({ boom: { id, type: 'pipe', message } })
    window.setTimeout(() => {
      const cur = get().boom
      if (cur && cur.id === id) set({ boom: null })
    }, 2600)
  },

  setAttackWarning: (w) => set({ attackWarning: w }),
  toggleDay: () => set((st) => ({ dayMode: !st.dayMode })),
  toggleScene: () => set((st) => ({ sceneMode: st.sceneMode === 'realistic' ? 'schematic' : 'realistic' })),
  setScene: (m) => set({ sceneMode: m }),
  setAppView: (view) =>
    set({
      appView: view,
      beacons: [],
      explosions: [],
      attackWarning: null,
      boom: null,
    }),
  setHospitalSnapshot: (snapshot) => set({ hospitalSnapshot: snapshot }),
  setHospitalConnected: (connected) => set({ hospitalConnected: connected }),
  setSelectedHospitalFacility: (id) => set({ selectedHospitalFacility: id }),
}))
