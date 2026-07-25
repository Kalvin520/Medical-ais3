import { Suspense, useEffect, useState } from 'react'
import Scene from './scene/Scene'
import { Hud } from './hud/Hud'
import { useWebSocket } from './net/useWebSocket'
import { useTelemetryEffects } from './hooks/useTelemetryEffects'

function Boot() {
  const [done, setDone] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), 1100)
    return () => window.clearTimeout(t)
  }, [])
  if (done) return null
  return (
    <div className="loader">
      <div className="col">
        <div className="ring" />
        <div>MEDICAL DEVICE RANGE · AIS3</div>
        <div style={{ fontSize: '0.62rem', letterSpacing: '2px', color: 'var(--text-faint)' }}>
          INITIALISING TELEMETRY · MODBUS/TCP · HL7 · DICOM
        </div>
      </div>
    </div>
  )
}

export default function App() {
  useWebSocket()
  useTelemetryEffects()

  return (
    <>
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
      <div className="hud-overlay-fx" />
      <Hud />
      <Boot />
    </>
  )
}
