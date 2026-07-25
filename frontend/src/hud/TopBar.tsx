// 頂列 — 品牌、設施切換器、寫實/示意、日夜、連線狀態（多廠區）
import { useState } from 'react'
import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile, FACILITY_ORDER } from '../facilities/profiles'
import { Icon } from './Icon'

function FacilitySwitcher() {
  const [open, setOpen] = useState(false)
  const facilities = usePlantStore((s) => s.facilities)
  const active = usePlantStore((s) => s.activeFacility)
  const setActiveFacility = usePlantStore((s) => s.setActiveFacility)

  // 後端尚未回傳清單前，以前端註冊表排序為後備
  const list =
    facilities.length > 0
      ? facilities
      : FACILITY_ORDER.map((id) => ({ id, name: getFacilityProfile(id).name, unitId: 0 }))

  const cur = getFacilityProfile(active)

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
                  className={'facsel-item' + (f.id === active ? ' on' : '')}
                  onClick={() => {
                    setActiveFacility(f.id)
                    setOpen(false)
                  }}
                  type="button"
                >
                  <Icon name={p.icon} size={15} />
                  <span className="facsel-item-name">{f.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export function TopBar() {
  const day = usePlantStore((s) => s.dayMode)
  const connected = usePlantStore((s) => s.connected)
  const toggleDay = usePlantStore((s) => s.toggleDay)
  const schematic = usePlantStore((s) => s.sceneMode) === 'schematic'
  const setScene = usePlantStore((s) => s.setScene)

  return (
    <div className="topbar">
      <div className="brand">
        <div>
          <div>醫療設備靶機</div>
          <div className="sub">MEDICAL DEVICE CYBER RANGE · MODBUS · HL7 · DICOM</div>
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

        <div className={'conn' + (connected ? ' on' : '')}>
          <span className="dot" /> {connected ? '已連線' : '連線中…'}
        </div>
      </div>
    </div>
  )
}
