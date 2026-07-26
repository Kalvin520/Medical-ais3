// 頂列 — 品牌、設施切換器、寫實/示意、日夜、連線狀態（多廠區）
import { useState } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile, FACILITY_ORDER } from '../facilities/profiles'
import { Icon } from './Icon'

function FacilitySwitcher() {
  const [open, setOpen] = useState(false)
  const facilities = usePlantStore((s) => s.facilities)
  const active = usePlantStore((s) => s.activeFacility)
  const appView = usePlantStore((s) => s.appView)
  const setActiveFacility = usePlantStore((s) => s.setActiveFacility)
  const setAppView = usePlantStore((s) => s.setAppView)
  const hospitalSnapshot = usePlantStore((s) => s.hospitalSnapshot)
  const selectedHospitalFacility = usePlantStore((s) => s.selectedHospitalFacility)
  const setSelectedHospitalFacility = usePlantStore((s) => s.setSelectedHospitalFacility)

  // 後端尚未回傳清單前，以前端註冊表排序為後備
  const list =
    facilities.length > 0
      ? facilities
      : FACILITY_ORDER.map((id) => ({ id, name: getFacilityProfile(id).name, unitId: 0 }))

  const hospitalFacilities = [
    { id: 'vendor-entry', name: '廠商安全入口', icon: 'shield-check' },
    { id: 'biomed-ws', name: '醫療工程工作站', icon: 'monitor' },
    { id: 'ehr-fhir', name: 'EHR / FHIR 資料中心', icon: 'database' },
    { id: 'hl7-engine', name: 'HL7 整合引擎', icon: 'network' },
    { id: 'ris-mwl', name: 'RIS / MWL 排程中心', icon: 'calendar' },
    { id: 'pacs', name: 'PACS 影像儲存中心', icon: 'hard-drive' },
    { id: 'protocol-runner', name: '協議工具箱', icon: 'terminal' },
    { id: 'bms', name: 'BMS 設施監控中心', icon: 'factory' },
    { id: 'chiller-sim', name: 'MRI 冷卻機房', icon: 'snowflake' },
  ].filter((item) => hospitalSnapshot?.facilities.some((facility) => facility.id === item.id) ?? true)

  const selectedHospitalMeta = hospitalFacilities.find((item) => item.id === selectedHospitalFacility)
  const cur = appView === 'hospital'
    ? { name: '迷你虛擬醫院總覽', icon: 'building-2' }
    : appView === 'hospital-facility'
      ? selectedHospitalMeta ?? { name: '醫院設備場域', icon: 'factory' }
      : getFacilityProfile(active)

  return (
    <div className="facsel">
      <button className="facsel-btn" onClick={() => setOpen((o) => !o)} type="button">
        <Icon name={cur.icon} size={15} />
        <span className="facsel-name">{cur.name}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <>
          <div className="facsel-scrim" onClick={() => setOpen(false)} />
          <div className="facsel-menu">
            {list.map((f) => {
              const p = getFacilityProfile(f.id)
              return (
                <button
                  key={f.id}
                  className={'facsel-item' + (appView === 'device' && f.id === active ? ' on' : '')}
                  onClick={() => {
                    setActiveFacility(f.id)
                    setAppView('device')
                    setOpen(false)
                  }}
                  type="button"
                >
                  <Icon name={p.icon} size={15} />
                  <span className="facsel-item-name">{f.name}</span>
                </button>
              )
            })}
            <div className="facsel-section-label">OVERVIEW</div>
            <button
              className={'facsel-item' + (appView === 'hospital' ? ' on' : '')}
              onClick={() => {
                setAppView('hospital')
                setOpen(false)
              }}
              type="button"
            >
              <Icon name="building-2" size={15} />
              <span className="facsel-item-name">迷你虛擬醫院總覽</span>
            </button>
            <div className="facsel-section-label">VIRTUAL HOSPITAL DEVICES</div>
            {hospitalFacilities.map((facility) => (
              <button
                key={facility.id}
                className={'facsel-item' + (appView === 'hospital-facility' && selectedHospitalFacility === facility.id ? ' on' : '')}
                onClick={() => {
                  setSelectedHospitalFacility(facility.id)
                  setAppView('hospital-facility')
                  setOpen(false)
                }}
                type="button"
              >
                <Icon name={facility.icon} size={15} />
                <span className="facsel-item-name">{facility.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function TopBar() {
  const day = usePlantStore((s) => s.dayMode)
  const connected = usePlantStore((s) => s.connected)
  const hospitalConnected = usePlantStore((s) => s.hospitalConnected)
  const appView = usePlantStore((s) => s.appView)
  const toggleDay = usePlantStore((s) => s.toggleDay)
  const schematic = usePlantStore((s) => s.sceneMode) === 'schematic'
  const setScene = usePlantStore((s) => s.setScene)
  const linkReady = appView === 'hospital' || appView === 'hospital-facility'
    ? hospitalConnected
    : connected

  return (
    <div className="topbar">
      <div className="brand">
        <div>
          <div>醫療資安數位孿生靶場</div>
          <div className="sub">VIRTUAL HOSPITAL · MODBUS · HL7 · DICOM · FHIR · BACNET</div>
        </div>
        <FacilitySwitcher />
      </div>
      <div className="topbar-tools">
        {/* 場景切換：分段式 */}
        <div className="seg" role="group" aria-label="場景切換">
          <button
            className={'seg-btn' + (!schematic ? ' on' : '')}
            onClick={() => setScene('realistic')}
            type="button"
            aria-pressed={!schematic}
          >
            <Icon name="building-2" size={14} /> 寫實
          </button>
          <button
            className={'seg-btn' + (schematic ? ' on' : '')}
            onClick={() => setScene('schematic')}
            type="button"
            aria-pressed={schematic}
          >
            <Icon name="waypoints" size={14} /> 示意
          </button>
        </div>

        <button
          className={'chip' + (day ? ' active-day' : '') + (schematic ? ' dim' : '')}
          onClick={toggleDay}
          type="button"
          aria-pressed={day}
          title={schematic ? '日夜僅影響寫實場景' : '切換日夜'}
        >
          <Icon name={day ? 'sun' : 'moon'} size={15} /> {day ? '白天' : '夜間'}
        </button>

        <div className={'conn' + (linkReady ? ' on' : '')}>
          <span className="dot" /> {linkReady ? '已連線' : '連線中…'}
        </div>
      </div>
    </div>
  )
}
