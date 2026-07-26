import { useMemo, useState } from 'react'
import { postHospitalReset } from '../net/api'
import { usePlantStore } from '../store/usePlantStore'
import { Icon } from './Icon'

const ZONE_NAMES: Record<string, string> = {
  dmz: 'DMZ 入口',
  clinical: '臨床區',
  integ: '整合區',
  imaging: '影像區',
  ot: 'OT 機房',
  mgmt: '管理區',
}

const DETAIL_NAMES: Record<string, string> = {
  status: '狀態',
  cooling: '冷卻',
  last_scan: '最近掃描',
  studies: '掃描紀錄',
  device_id: 'Device ID',
  source: '來源',
  last_write_peer: '最後寫入',
  message_count: '訊息數',
  worklist_count: 'Worklist',
  name: '名稱',
  study_count: 'Study 數',
  version: '版本',
  fhir_version: 'FHIR',
  patient_count: 'Patient 數',
  seed_version: 'Seed',
  ssh: 'SSH Port',
  reachable: '可連線',
  paralyzed: '已癱瘓',
  tools: '協議工具',
  marker: '標記檔',
}

function formatDetail(value: unknown): string {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function HospitalHud() {
  const snapshot = usePlantStore((s) => s.hospitalSnapshot)
  const selectedId = usePlantStore((s) => s.selectedHospitalFacility)
  const setSelected = usePlantStore((s) => s.setSelectedHospitalFacility)
  const addAlert = usePlantStore((s) => s.addAlert)
  const [resetting, setResetting] = useState(false)

  const selected = snapshot?.facilities.find((facility) => facility.id === selectedId)
  const zones = useMemo(() => {
    const result: Record<string, { online: number; total: number }> = {}
    for (const facility of snapshot?.facilities ?? []) {
      const row = result[facility.zone] ?? { online: 0, total: 0 }
      row.total += 1
      if (facility.online) row.online += 1
      result[facility.zone] = row
    }
    return result
  }, [snapshot])

  const resetHospital = async () => {
    if (resetting) return
    setResetting(true)
    const ok = await postHospitalReset()
    addAlert(ok ? '虛擬醫院已開始重播合成 Seed' : '醫院 Reset 失敗，請確認容器健康狀態', ok ? 1 : 3, ok ? 'check' : 'x')
    setResetting(false)
  }

  return (
    <>
      <div className="rail left hospital-rail">
        <section className="glass hospital-panel">
          <div className="panel-title">
            <Icon name="building-2" size={15} />
            醫院場域狀態
          </div>
          <div className="hospital-summary">
            <div>
              <span>ONLINE</span>
              <strong>{snapshot?.summary.online ?? 0}/{snapshot?.summary.total ?? 11}</strong>
            </div>
            <div>
              <span>COOLING</span>
              <strong className={snapshot?.summary.cooling === 'ALARM' ? 'danger-text' : ''}>
                {snapshot?.summary.cooling ?? '—'}
              </strong>
            </div>
            <div>
              <span>MRI</span>
              <strong className={snapshot?.summary.mri_status === 'PROTECTIVE_STOP' ? 'danger-text' : ''}>
                {snapshot?.summary.mri_status ?? '—'}
              </strong>
            </div>
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
        </section>

        <section className="glass hospital-panel hospital-flow-panel">
          <div className="panel-title">
            <Icon name="waypoints" size={15} />
            資料與攻擊路徑
          </div>
          <div className="flow-legend"><i className="clinical" /> HL7 → RIS → MRI → PACS → FHIR</div>
          <div className="flow-legend"><i className="cooling" /> Chiller → BMS → MRI 聯鎖</div>
          <div className="flow-legend"><i className="attack" /> Vendor → Biomed 橫向路徑</div>
        </section>
      </div>

      <div className="rail right hospital-rail">
        <section className="glass hospital-panel hospital-detail">
          <div className="panel-title">
            <Icon name="activity" size={15} />
            選取設施
          </div>
          {selected ? (
            <>
              <div className="hospital-selected-heading">
                <div>
                  <span>{ZONE_NAMES[selected.zone] ?? selected.zone}</span>
                  <h2>{selected.label}</h2>
                </div>
                <span className={`hospital-level ${selected.level}`}>{selected.level.toUpperCase()}</span>
              </div>
              <dl className="hospital-detail-grid">
                <dt>ID</dt><dd>{selected.id}</dd>
                <dt>IP</dt><dd>{selected.ip}</dd>
                {Object.entries(selected.detail ?? {}).map(([key, value]) => (
                  <div className="hospital-detail-row" key={key}>
                    <dt>{DETAIL_NAMES[key] ?? key}</dt>
                    <dd>{formatDetail(value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="hospital-links">
                {(selected.links ?? []).map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                    {link.label}<Icon name="external-link" size={12} />
                  </a>
                ))}
                {(selected.links ?? []).length === 0 && (
                  <p>SSH 節點請由 Host Port 2221、2222 或 2223 連線。</p>
                )}
              </div>
            </>
          ) : (
            <p className="hospital-empty">點選場景中的設施查看即時狀態。</p>
          )}
        </section>
      </div>

      <div className="bottombar hospital-bottombar">
        <div className="status-chip on">
          <span className="ic"><Icon name="radio-tower" size={15} /></span>
          <span>Hospital Snapshot</span>
          <span className="chip-state">2.5s</span>
        </div>
        <button className="status-chip hospital-action" type="button" onClick={() => setSelected('mri-sim')}>
          <span className="ic"><Icon name="scan" size={15} /></span>
          <span>定位 MRI</span>
        </button>
        <button className="status-chip hospital-action reset" type="button" disabled={resetting} onClick={resetHospital}>
          <span className="ic"><Icon name="rotate-ccw" size={15} /></span>
          <span>{resetting ? '重置中…' : '重置全場'}</span>
        </button>
      </div>
    </>
  )
}
