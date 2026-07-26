import { useMemo, useState } from 'react'
import { fetchHospitalSnapshot, postHospitalAttack, postHospitalReset } from '../net/api'
import { usePlantStore } from '../store/usePlantStore'
import type { HospitalAttackType } from '../types/telemetry'
import { Icon } from './Icon'

const ZONE_NAMES: Record<string, string> = {
  dmz: 'DMZ 入口區',
  clinical: '臨床服務區',
  integ: '醫療整合區',
  imaging: '醫療影像區',
  ot: '設施 OT 區',
}

const DETAIL_NAMES: Record<string, string> = {
  ssh: 'SSH Port',
  reachable: '網路可達',
  fhir_version: 'FHIR 版本',
  patient_count: 'Patient 數',
  message_count: 'HL7 訊息',
  worklist_count: 'Worklist',
  name: '節點名稱',
  study_count: 'Study 數',
  version: '軟體版本',
  status: '設備狀態',
  cooling: '冷卻狀態',
  last_scan: '最近掃描',
  studies: '掃描紀錄',
  device_id: 'BACnet Device',
  source: '資料來源',
  last_write_peer: '最後寫入來源',
  paralyzed: '工具癱瘓',
  tools: '可用協議工具',
  integrity: '資料完整性',
}

const ATTACK_META: Record<Exclude<HospitalAttackType, 'all'>, { label: string; target: string; icon: string }> = {
  cooling: { label: '停止冷卻', target: 'BACnet / MRI', icon: 'snowflake' },
  hl7: { label: '醫囑錯配', target: 'HL7 / RIS', icon: 'file-warning' },
  lateral: { label: '橫向移動', target: 'Vendor → Biomed', icon: 'waypoints' },
}

const ATTACKS_BY_FACILITY: Record<string, Array<Exclude<HospitalAttackType, 'all'>>> = {
  'vendor-entry': ['lateral'],
  'biomed-ws': ['lateral'],
  'ehr-fhir': ['lateral'],
  'hl7-engine': ['hl7'],
  'ris-mwl': ['hl7'],
  pacs: ['lateral'],
  'protocol-runner': ['lateral', 'hl7', 'cooling'],
  bms: ['cooling'],
  'chiller-sim': ['cooling'],
}

function formatValue(value: unknown): string {
  if (value === true) return 'YES'
  if (value === false) return 'NO'
  if (value == null || value === '') return '—'
  if (typeof value === 'object') {
    if (Array.isArray(value)) return `${value.length} ITEMS`
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${item === true ? 'ON' : item === false ? 'OFF' : String(item)}`)
      .join(' · ')
  }
  return String(value)
}

export function HospitalFacilityHud() {
  const snapshot = usePlantStore((state) => state.hospitalSnapshot)
  const connected = usePlantStore((state) => state.hospitalConnected)
  const selectedId = usePlantStore((state) => state.selectedHospitalFacility) ?? 'vendor-entry'
  const setSnapshot = usePlantStore((state) => state.setHospitalSnapshot)
  const setAppView = usePlantStore((state) => state.setAppView)
  const [pending, setPending] = useState<HospitalAttackType | 'reset' | null>(null)
  const [actionError, setActionError] = useState('')

  const facility = snapshot?.facilities.find((item) => item.id === selectedId)
  const activeAttacks = snapshot?.active_attacks ?? []
  const attacks = ATTACKS_BY_FACILITY[selectedId] ?? []
  const details = useMemo(() => Object.entries(facility?.detail ?? {}), [facility])
  const alerts = snapshot?.events ?? []
  const isAlarm = facility?.level === 'alarm'

  const refresh = async () => {
    const next = await fetchHospitalSnapshot()
    if (!next) return
    const facilities = next.facilities.filter((item) => item.id !== 'reset-controller')
    setSnapshot({
      ...next,
      facilities,
      summary: {
        ...next.summary,
        online: facilities.filter((item) => item.online).length,
        total: facilities.length,
        alarms: facilities.filter((item) => item.level === 'alarm').length,
      },
    })
  }

  const runAttack = async (type: HospitalAttackType) => {
    if (pending) return
    setPending(type)
    setActionError('')
    const ok = await postHospitalAttack(type)
    if (!ok) setActionError('模擬未完成，請確認醫院服務與網路狀態。')
    await refresh()
    setPending(null)
  }

  const resetHospital = async () => {
    if (pending) return
    setPending('reset')
    setActionError('')
    const ok = await postHospitalReset()
    if (!ok) setActionError('重置未完整完成，請檢查後端 Reset Controller。')
    await refresh()
    setPending(null)
  }

  return (
    <>
      <div className="rail left hospital-device-rail">
        <section className="glass pad">
          <div className="panel-title">
            <Icon name="signal-high" size={17} /> 即時遙測 · TELEMETRY
          </div>
          <div className="hospital-device-identity">
            <div>
              <span>{ZONE_NAMES[facility?.zone ?? ''] ?? facility?.zone ?? 'HOSPITAL DEVICE'}</span>
              <strong>{facility?.label ?? selectedId}</strong>
              <small>{facility?.ip ?? '等待快照…'}</small>
            </div>
            <em className={facility?.level ?? 'offline'}>{facility?.level?.toUpperCase() ?? 'OFFLINE'}</em>
          </div>

          <div className="tele-group-label">核心狀態 · CORE</div>
          <div className="hospital-device-core">
            <div className={!facility?.online ? 'danger' : ''}>
              <span>服務連線</span><strong>{facility?.online ? 'ONLINE' : 'OFFLINE'}</strong>
            </div>
            <div className={isAlarm ? 'danger' : ''}>
              <span>設備警報</span><strong>{isAlarm ? 'ALARM' : 'NORMAL'}</strong>
            </div>
            <div className={activeAttacks.length ? 'warning' : ''}>
              <span>攻擊鏈路</span><strong>{activeAttacks.length} ACTIVE</strong>
            </div>
          </div>

          <div className="tele-group-label">設備遙測 · DEVICE DATA</div>
          <div className="hospital-device-details">
            {details.map(([key, value]) => (
              <div key={key} className={key === 'status' && String(value).includes('STOP') ? 'danger' : ''}>
                <span>{DETAIL_NAMES[key] ?? key}</span>
                <strong title={formatValue(value)}>{formatValue(value)}</strong>
              </div>
            ))}
            {details.length === 0 && <p>等待設備遙測資料…</p>}
          </div>
        </section>

        <section className="glass pad">
          <div className="panel-title">
            <Icon name="settings-2" size={17} /> 設備控制器 · STATUS
          </div>
          <div className="hospital-device-coils">
            <div>
              <i className={connected ? 'on' : 'off'} />
              <span>Hospital Link</span>
              <small>{connected ? 'CONNECTED' : 'WAITING'}</small>
            </div>
            <div>
              <i className={facility?.online ? 'on' : 'off'} />
              <span>Service Process</span>
              <small>{facility?.online ? 'RUNNING' : 'DOWN'}</small>
            </div>
            <div>
              <i className={isAlarm ? 'off' : 'on'} />
              <span>Safety State</span>
              <small>{isAlarm ? 'DEGRADED' : 'NORMAL'}</small>
            </div>
          </div>
          {facility?.links?.length ? (
            <div className="hospital-device-links">
              {facility.links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}<Icon name="external-link" size={14} />
                </a>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <div className="rail right hospital-device-rail">
        <section className="glass pad">
          <div className="panel-title">
            <Icon name="siren" size={17} /> 警報紀錄 · ALERTS
            <span className="spacer" />
            <span className="hospital-alert-count">{alerts.length + (actionError ? 1 : 0)}</span>
          </div>
          <div className="alerts-body hospital-alerts">
            {actionError && (
              <div className="alert-item lvl-3"><Icon name="x" size={15} /><span>{actionError}</span></div>
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
          <div className="panel-title">
            <Icon name="crosshair" size={17} /> 攻擊模擬 · ATTACK SIM
          </div>
          <div className="attack-body">
            <div className="attack-grid hospital-attack-grid">
              {attacks.map((type) => {
                const attack = ATTACK_META[type]
                return (
                  <button
                    key={type}
                    className={`btn btn-attack${activeAttacks.includes(type) ? ' active-attack' : ''}`}
                    disabled={Boolean(pending)}
                    onClick={() => void runAttack(type)}
                    type="button"
                  >
                    <Icon name={attack.icon} size={16} />
                    <span className="atk-label">{pending === type ? '執行中…' : attack.label}</span>
                    <span className="tail">{attack.target}</span>
                  </button>
                )
              })}
            </div>
            <button className="btn btn-attack critical" disabled={Boolean(pending)} onClick={() => void runAttack('all')} type="button">
              <Icon name="radiation" size={16} /> {pending === 'all' ? '全面攻擊執行中…' : '全面攻擊 — 醫院鏈路聯動'}
            </button>
            <button className="btn btn-reset" disabled={Boolean(pending)} onClick={() => void resetHospital()} type="button">
              <Icon name="rotate-ccw" size={16} /> {pending === 'reset' ? '重播 Seed 中…' : '重製虛擬醫院預設值'}
            </button>
          </div>
        </section>
      </div>

      <div className="bottombar hospital-bottombar">
        <button className="status-chip hospital-action" type="button" onClick={() => setAppView('hospital')}>
          <span className="ic"><Icon name="building-2" size={17} /></span>
          <span>返回醫院總覽</span>
        </button>
        <div className={`status-chip ${facility?.online ? 'on' : 'alarm'}`}>
          <span className="ic"><Icon name="radio-tower" size={17} /></span>
          <span>{facility?.label ?? selectedId}</span>
          <span className="chip-state">{facility?.online ? 'LIVE' : 'OFFLINE'}</span>
        </div>
        <div className={`status-chip ${isAlarm ? 'alarm' : 'on'}`}>
          <span className="ic"><Icon name={isAlarm ? 'siren' : 'check'} size={17} /></span>
          <span>設備狀態</span>
          <span className="chip-state">{isAlarm ? 'ALARM' : 'NORMAL'}</span>
        </div>
      </div>
    </>
  )
}
