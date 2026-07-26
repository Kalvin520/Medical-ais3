import { useMemo, useState } from 'react'
import { fetchHospitalSnapshot, postHospitalAttack, postHospitalReset } from '../net/api'
import { usePlantStore } from '../store/usePlantStore'
import type { HospitalAttackType, HospitalFacility } from '../types/telemetry'
import { Icon } from './Icon'

const ZONE_NAMES: Record<string, string> = {
  dmz: 'DMZ 入口',
  clinical: '臨床區',
  integ: '整合區',
  imaging: '影像區',
  ot: 'OT 機房',
}

const DETAIL_NAMES: Record<string, string> = {
  status: '狀態',
  cooling: '冷卻',
  last_scan: '最近掃描',
  studies: '掃描紀錄',
  device_id: 'Device ID',
  source: '來源',
  last_write_peer: '最後寫入',
  message_count: 'HL7 訊息',
  worklist_count: 'Worklist',
  study_count: 'PACS Study',
  patient_count: 'FHIR Patient',
  seed_version: 'Seed',
  reachable: '可連線',
  paralyzed: '已癱瘓',
  integrity: '資料完整性',
}

const ATTACKS: Array<{
  type: Exclude<HospitalAttackType, 'all'>
  label: string
  target: string
  icon: string
}> = [
  { type: 'cooling', label: '停止冷卻', target: 'BACnet', icon: 'snowflake' },
  { type: 'hl7', label: '醫囑錯配', target: 'HL7 / RIS', icon: 'file-warning' },
  { type: 'lateral', label: '橫向移動', target: 'Vendor → Biomed', icon: 'waypoints' },
]

function formatDetail(value: unknown): string {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function facilityById(facilities: HospitalFacility[], id: string) {
  return facilities.find((facility) => facility.id === id)
}

function detailValue(facilities: HospitalFacility[], id: string, key: string) {
  return formatDetail(facilityById(facilities, id)?.detail?.[key])
}

export function HospitalHud() {
  const snapshot = usePlantStore((s) => s.hospitalSnapshot)
  const connected = usePlantStore((s) => s.hospitalConnected)
  const selectedId = usePlantStore((s) => s.selectedHospitalFacility)
  const setSelected = usePlantStore((s) => s.setSelectedHospitalFacility)
  const setSnapshot = usePlantStore((s) => s.setHospitalSnapshot)
  const setAppView = usePlantStore((s) => s.setAppView)
  const setActiveFacility = usePlantStore((s) => s.setActiveFacility)
  const [pending, setPending] = useState<HospitalAttackType | 'reset' | null>(null)
  const [open, setOpen] = useState(true)
  const [actionError, setActionError] = useState('')

  const facilities = snapshot?.facilities ?? []
  const selected = facilityById(facilities, selectedId ?? '')
  const activeAttacks = snapshot?.active_attacks ?? []
  const onlineRate = snapshot?.summary.total
    ? Math.round((snapshot.summary.online / snapshot.summary.total) * 100)
    : 0

  const zones = useMemo(() => {
    const result: Record<string, { online: number; total: number }> = {}
    for (const facility of facilities) {
      const row = result[facility.zone] ?? { online: 0, total: 0 }
      row.total += 1
      if (facility.online) row.online += 1
      result[facility.zone] = row
    }
    return result
  }, [facilities])

  const refresh = async () => {
    const next = await fetchHospitalSnapshot()
    if (next) setSnapshot(next)
  }

  const runAttack = async (type: HospitalAttackType) => {
    if (pending) return
    setPending(type)
    setActionError('')
    const ok = await postHospitalAttack(type)
    if (!ok) setActionError('攻擊模擬失敗，請確認醫院容器與服務狀態。')
    await refresh()
    setPending(null)
  }

  const resetHospital = async () => {
    if (pending) return
    setPending('reset')
    setActionError('')
    const ok = await postHospitalReset()
    if (!ok) setActionError('重置未完整完成，請確認 Reset Controller 狀態。')
    await refresh()
    setPending(null)
  }

  const enterSelectedFacility = () => {
    if (!selectedId) return
    if (selectedId === 'mri-sim') {
      setActiveFacility('mri')
      setAppView('device')
      return
    }
    setAppView('hospital-facility')
  }

  const alerts = snapshot?.events ?? []

  return (
    <>
      <div className="rail left hospital-rail">
        <section className="glass pad">
          <div className="panel-title">
            <Icon name="signal-high" size={17} />
            即時遙測 · TELEMETRY
          </div>

          <div className="tele-group-label">核心感測 · CORE</div>
          <div className="hospital-metric-grid core">
            <div className={`hospital-metric ${onlineRate < 100 ? 'warning' : ''}`}>
              <span>設施連線率</span>
              <strong>{onlineRate}<small>%</small></strong>
              <i><b style={{ width: `${onlineRate}%` }} /></i>
            </div>
            <div className={`hospital-metric ${(snapshot?.summary.alarms ?? 0) > 0 ? 'danger' : ''}`}>
              <span>即時警報</span>
              <strong>{snapshot?.summary.alarms ?? 0}<small> NODE</small></strong>
              <i><b style={{ width: `${Math.min(100, (snapshot?.summary.alarms ?? 0) * 24)}%` }} /></i>
            </div>
            <div className={`hospital-metric ${activeAttacks.length > 0 ? 'danger' : ''}`}>
              <span>攻擊鏈路</span>
              <strong>{activeAttacks.length}<small> ACTIVE</small></strong>
              <i><b style={{ width: `${Math.min(100, activeAttacks.length * 34)}%` }} /></i>
            </div>
          </div>

          <div className="tele-group-label">衍生遙測 · DERIVED</div>
          <div className="hospital-metric-grid derived">
            <div className={snapshot?.summary.cooling === 'ALARM' ? 'danger' : ''}><span>冷卻迴路</span><strong>{snapshot?.summary.cooling ?? '—'}</strong></div>
            <div className={snapshot?.summary.mri_status === 'PROTECTIVE_STOP' ? 'danger' : ''}><span>MRI 狀態</span><strong>{snapshot?.summary.mri_status ?? '—'}</strong></div>
            <div><span>HL7 訊息</span><strong>{detailValue(facilities, 'hl7-engine', 'message_count')}</strong></div>
            <div><span>RIS Worklist</span><strong>{detailValue(facilities, 'ris-mwl', 'worklist_count')}</strong></div>
            <div><span>PACS Study</span><strong>{detailValue(facilities, 'pacs', 'study_count')}</strong></div>
            <div><span>FHIR Patient</span><strong>{detailValue(facilities, 'ehr-fhir', 'patient_count')}</strong></div>
            <div className={facilityById(facilities, 'protocol-runner')?.level === 'alarm' ? 'danger' : ''}>
              <span>協議工具箱</span><strong>{detailValue(facilities, 'protocol-runner', 'status')}</strong>
            </div>
            <div className={!connected ? 'danger' : ''}><span>快照連線</span><strong>{connected ? 'ONLINE' : 'WAITING'}</strong></div>
          </div>
        </section>

        <section className="glass pad hospital-controller-panel">
          <div className="panel-title">
            <Icon name="waypoints" size={17} />
            場域控制器 · ZONES
          </div>
          <div className="hospital-zone-list">
            {Object.entries(ZONE_NAMES).map(([id, name]) => {
              const state = zones[id] ?? { online: 0, total: 0 }
              return (
                <div key={id} className="hospital-zone-row">
                  <span>{name}</span>
                  <span className={state.total > 0 && state.online === state.total ? 'ok-text' : 'muted-text'}>
                    {state.online}/{state.total || '—'}
                  </span>
                </div>
              )
            })}
          </div>
          {selected && (
            <div className="hospital-selected-compact">
              <button type="button" onClick={() => setSelected(selected.id)}>
                <span>{ZONE_NAMES[selected.zone] ?? selected.zone}</span>
                <strong>{selected.label}</strong>
                <em className={selected.level}>{selected.level.toUpperCase()}</em>
              </button>
              <dl>
                <dt>IP</dt><dd>{selected.ip}</dd>
                {Object.entries(selected.detail ?? {}).slice(0, 4).map(([key, value]) => (
                  <div className="hospital-detail-row" key={key}>
                    <dt>{DETAIL_NAMES[key] ?? key}</dt>
                    <dd>{formatDetail(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      </div>

      <div className="rail right hospital-rail">
        <section className="glass pad">
          <div className="panel-title">
            <Icon name="siren" size={17} /> 警報紀錄 · ALERTS
            <span className="spacer" />
            <span className="hospital-alert-count">{alerts.length + (actionError ? 1 : 0)}</span>
          </div>
          <div className="alerts-body hospital-alerts">
            {actionError && (
              <div className="alert-item lvl-3">
                <Icon name="x" size={15} /><span>{actionError}</span>
              </div>
            )}
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`alert-item${alert.level >= 4 ? ' lvl-4' : alert.level === 3 ? ' lvl-3' : alert.level === 2 ? ' lvl-2' : ''}`}
              >
                <Icon name={alert.icon ?? 'signal-high'} size={15} />
                <span><span className="ts">[{alert.time}]</span> {alert.message}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass pad">
          <div className="panel-title hospital-clickable" onClick={() => setOpen((value) => !value)}>
            <Icon name="crosshair" size={17} /> 攻擊模擬 · ATTACK SIM
            <span className="spacer" />
            <Icon name="chevron-down" size={16} />
          </div>
          {open && (
            <div className="attack-body">
              <div className="attack-grid hospital-attack-grid">
                {ATTACKS.map((attack) => (
                  <button
                    key={attack.type}
                    className={`btn btn-attack${activeAttacks.includes(attack.type) ? ' active-attack' : ''}`}
                    disabled={Boolean(pending)}
                    onClick={() => void runAttack(attack.type)}
                    type="button"
                    title={`${attack.label} → ${attack.target}`}
                  >
                    <Icon name={attack.icon} size={16} />
                    <span className="atk-label">{pending === attack.type ? '執行中…' : attack.label}</span>
                    <span className="tail">{attack.target}</span>
                  </button>
                ))}
              </div>
              <button
                className="btn btn-attack critical"
                disabled={Boolean(pending)}
                onClick={() => void runAttack('all')}
                type="button"
              >
                <Icon name="radiation" size={16} /> {pending === 'all' ? '全面攻擊執行中…' : '全面攻擊 — 全設施連鎖故障'}
              </button>
              <button className="btn btn-reset" disabled={Boolean(pending)} onClick={() => void resetHospital()} type="button">
                <Icon name="rotate-ccw" size={16} /> {pending === 'reset' ? '重播合成 Seed 中…' : '重製虛擬醫院預設值'}
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="bottombar hospital-bottombar">
        <div className={`status-chip ${connected ? 'on' : 'alarm'}`}>
          <span className="ic"><Icon name="radio-tower" size={17} /></span>
          <span>Hospital Snapshot</span>
          <span className="chip-state">{connected ? '2.5s' : 'OFFLINE'}</span>
        </div>
        <div className={`status-chip ${activeAttacks.length ? 'alarm' : 'on'}`}>
          <span className="ic"><Icon name={activeAttacks.length ? 'radiation' : 'check'} size={17} /></span>
          <span>攻擊鏈路</span>
          <span className="chip-state">{activeAttacks.length ? `${activeAttacks.length} ACTIVE` : 'NORMAL'}</span>
        </div>
        <button className="status-chip hospital-action" type="button" onClick={() => setSelected('mri-sim')}>
          <span className="ic"><Icon name="scan" size={17} /></span>
          <span>定位 MRI</span>
        </button>
        <button className="status-chip hospital-action" type="button" disabled={!selectedId} onClick={enterSelectedFacility}>
          <span className="ic"><Icon name="layers" size={17} /></span>
          <span>進入選取設備</span>
        </button>
      </div>
    </>
  )
}
