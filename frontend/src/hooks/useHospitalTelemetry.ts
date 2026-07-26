import { useEffect } from 'react'
import { fetchHospitalSnapshot } from '../net/api'
import { usePlantStore } from '../store/usePlantStore'

const POLL_INTERVAL_MS = 2500

export function useHospitalTelemetry() {
  useEffect(() => {
    let active = true
    let timer: number | undefined

    const poll = async () => {
      const snapshot = await fetchHospitalSnapshot()
      if (!active) return

      const store = usePlantStore.getState()
      store.setHospitalConnected(Boolean(snapshot?.ok))
      if (snapshot) store.setHospitalSnapshot(snapshot)

      timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])
}
