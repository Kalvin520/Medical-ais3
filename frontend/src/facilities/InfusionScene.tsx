// ============================================================
// 輸液幫浦病房 IV Infusion Pump Ward — 專屬寫實 / 示意 3D 場景
// 由即時 Modbus 遙測驅動：3 張病床（同一輸液線複製）、IV 點滴架、
// 藥袋（餘量→填充、濃度→染色）、滴注室（滴速→落滴）、輸液幫浦
// （狀態燈 + 警報，警報靜音時隱藏）、輸液管（空氣→氣泡）、生命徵象
// 監視器（ECG 波形，過量→紅色平線）、中央護理站 PLC 櫃、警示燈塔。
// 教學 / 防禦用途。
// ============================================================

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { usePlantStore } from '../store/usePlantStore'

const OK = '#34d399'
const WARN = '#fbbf24'
const DANGER = '#fb4268'

const BAYS = [0, 1, 2]
const BAY_X = [-22, 0, 22]
const DROPS = 6
const BUBBLES = 9

// ── 材質切換：示意=半透明全像，寫實=PBR 實體 ──
function M({
  schematic,
  color,
  metalness,
  roughness,
  emissive,
}: {
  schematic: boolean
  color: string
  metalness?: number
  roughness?: number
  emissive?: string
}) {
  if (schematic) {
    return (
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.7}
        transparent
        opacity={0.34}
        metalness={0.1}
        roughness={0.5}
        toneMapped={false}
      />
    )
  }
  return (
    <meshStandardMaterial
      color={color}
      metalness={metalness ?? 0.6}
      roughness={roughness ?? 0.5}
      emissive={emissive ?? '#000000'}
      emissiveIntensity={emissive ? 1 : 0}
    />
  )
}

// ── ECG 單一心跳波形（u ∈ [0,1)），回傳 ~[-0.3, 1.0] ──
function ecg(u: number): number {
  const p = 0.12 * Math.exp(-Math.pow((u - 0.2) / 0.045, 2))
  const q = -0.16 * Math.exp(-Math.pow((u - 0.44) / 0.018, 2))
  const r = 1.0 * Math.exp(-Math.pow((u - 0.5) / 0.02, 2))
  const s = -0.28 * Math.exp(-Math.pow((u - 0.56) / 0.02, 2))
  const t = 0.22 * Math.exp(-Math.pow((u - 0.78) / 0.06, 2))
  return p + q + r + s + t
}

// ── 靜態病床（床架 + 床墊 + 枕頭 + 床頭 / 床尾板 + 病患輪廓） ──
function Bed({ schematic }: { schematic: boolean }) {
  return (
    <group>
      {/* 四支床腳 */}
      {[
        [-1.05, -2.2],
        [1.05, -2.2],
        [-1.05, 2.2],
        [1.05, 2.2],
      ].map(([lx, lz], k) => (
        <mesh key={k} position={[lx, 0.36, lz]} castShadow receiveShadow>
          <boxGeometry args={[0.14, 0.72, 0.14]} />
          <M schematic={schematic} color="#8a939d" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}
      {/* 床架 */}
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.22, 5.0]} />
        <M schematic={schematic} color="#aeb6bf" metalness={0.8} roughness={0.4} />
      </mesh>
      {/* 側護欄 */}
      {[-1.16, 1.16].map((lx, k) => (
        <mesh key={k} position={[lx, 1.18, 0.2]} castShadow>
          <boxGeometry args={[0.06, 0.5, 3.0]} />
          <M schematic={schematic} color="#c7ccd2" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {/* 床墊 */}
      <mesh position={[0, 1.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.3, 4.7]} />
        <M schematic={schematic} color="#e9eef2" metalness={0.05} roughness={0.85} />
      </mesh>
      {/* 枕頭 */}
      <mesh position={[0, 1.24, -1.85]} castShadow>
        <boxGeometry args={[1.5, 0.2, 0.72]} />
        <M schematic={schematic} color="#f5f8fb" metalness={0.04} roughness={0.9} />
      </mesh>
      {/* 床頭板 / 床尾板 */}
      <mesh position={[0, 1.24, -2.55]} castShadow>
        <boxGeometry args={[2.4, 1.1, 0.12]} />
        <M schematic={schematic} color="#dbe1e8" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.06, 2.55]} castShadow>
        <boxGeometry args={[2.4, 0.78, 0.12]} />
        <M schematic={schematic} color="#dbe1e8" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* 病患頭部（枕上） */}
      <mesh position={[0, 1.4, -1.75]} castShadow>
        <sphereGeometry args={[0.27, 20, 20]} />
        <M schematic={schematic} color="#e7b48a" metalness={0.02} roughness={0.7} />
      </mesh>
      {/* 蓋被隆起（軀幹 + 腿） */}
      <mesh position={[0, 1.32, 0.35]} castShadow>
        <boxGeometry args={[1.85, 0.42, 3.0]} />
        <M schematic={schematic} color="#4f8fc7" metalness={0.03} roughness={0.85} />
      </mesh>
      {/* 手臂（伸向點滴架 / 輸液管） */}
      <mesh position={[-0.32, 1.16, 0.15]} rotation={[0.15, -0.35, 0]} castShadow>
        <boxGeometry args={[0.17, 0.17, 1.35]} />
        <M schematic={schematic} color="#e7b48a" metalness={0.02} roughness={0.7} />
      </mesh>
    </group>
  )
}

// ── 靜態 IV 點滴架（輪座 + 立柱 + 掛鉤） ──
function IVPole({ schematic }: { schematic: boolean }) {
  return (
    <group position={[-1.7, 0, -2.0]}>
      {/* 輪座 */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.08, 20]} />
        <M schematic={schematic} color="#9aa3ad" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* 立柱 */}
      <mesh position={[0, 2.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 5.8, 14]} />
        <M schematic={schematic} color="#c7ccd2" metalness={0.92} roughness={0.25} />
      </mesh>
      {/* 頂端掛鉤 */}
      <mesh position={[0, 5.75, 0.06]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.09, 0.02, 10, 20]} />
        <M schematic={schematic} color="#c7ccd2" metalness={0.92} roughness={0.25} />
      </mesh>
    </group>
  )
}

export function InfusionScene({ schematic }: { schematic: boolean }) {
  // ── 反應式讀取（渲染期；動畫外） ──
  const st = usePlantStore((s) => s.statuses['infusion']) as Record<string, number | boolean> | undefined
  const N = (k: string, d: number): number => {
    const v = st?.[k]
    return typeof v === 'number' ? v : d
  }
  const Bl = (k: string, d: boolean): boolean => {
    const v = st?.[k]
    return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : d
  }

  const flowRate = N('flowRate', 100)
  const drugConc = N('drugConc', 1.0)
  const linePressure = N('linePressure', 0.9)
  const doseRateBody = N('doseRateBody', 1.0)
  const airInLine = N('airInLine', 0)
  const reservoirLevel = N('reservoirLevel', 50)

  const emergencyEnable = Bl('emergencyEnable', true)
  const pumpRun = Bl('pumpRun', true)
  const alarmSilence = Bl('alarmSilence', false)
  const running = pumpRun && emergencyEnable
  const explosionType = String(st?.explosionType ?? 'none')
  const failing = explosionType !== 'none'

  // ── 整體嚴重度（管壓 / 每公斤劑量 / 管路空氣 / 藥袋低量 + 故障） ──
  let sev = 0
  const bump = (w: boolean, d: boolean) => {
    if (d) sev = Math.max(sev, 2)
    else if (w) sev = Math.max(sev, 1)
  }
  bump(linePressure >= 3, linePressure >= 5)
  bump(doseRateBody >= 5, doseRateBody >= 8)
  bump(airInLine >= 30, airInLine >= 50)
  bump(reservoirLevel <= 20, reservoirLevel <= 8)
  if (failing) sev = 2
  const sevColor = sev === 2 ? DANGER : sev === 1 ? WARN : OK

  // ── 藥液顏色：清澈→琥珀（濃度）；過量→毒綠 ──
  const fluidCol = useMemo(() => {
    if (explosionType === 'overdose') return '#8bff3a'
    const t = Math.min(1, drugConc / 8)
    const c = new THREE.Color('#bfe3ff').lerp(new THREE.Color('#efb028'), t)
    return `#${c.getHexString()}`
  }, [drugConc, explosionType])

  // ── 幾何 / 材質：一次性建立、以 <primitive> 掛載、於 useFrame 直接操作 ──
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmpV = useMemo(() => new THREE.Vector3(), [])

  const tubeCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.7, 3.78, -2.0),
        new THREE.Vector3(-1.62, 2.9, -1.5),
        new THREE.Vector3(-1.25, 1.85, -0.5),
        new THREE.Vector3(-0.6, 1.25, 0.2),
        new THREE.Vector3(-0.28, 1.14, 0.6),
      ]),
    [],
  )
  const tubeGeo = useMemo(() => new THREE.TubeGeometry(tubeCurve, 48, 0.05, 8, false), [tubeCurve])

  const drops = useMemo(
    () =>
      BAYS.map(() => {
        const geo = new THREE.SphereGeometry(0.045, 8, 8)
        const mat = new THREE.MeshStandardMaterial({
          color: '#bfe3ff',
          emissive: '#bfe3ff',
          emissiveIntensity: 0.4,
          metalness: 0.1,
          roughness: 0.3,
          toneMapped: false,
        })
        const inst = new THREE.InstancedMesh(geo, mat, DROPS)
        inst.frustumCulled = false
        return inst
      }),
    [],
  )

  const bubbles = useMemo(
    () =>
      BAYS.map(() => {
        const geo = new THREE.SphereGeometry(0.055, 8, 8)
        const mat = new THREE.MeshStandardMaterial({
          color: '#f2f8ff',
          emissive: '#dff0ff',
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.85,
          metalness: 0.0,
          roughness: 0.2,
          toneMapped: false,
        })
        const inst = new THREE.InstancedMesh(geo, mat, BUBBLES)
        inst.frustumCulled = false
        return inst
      }),
    [],
  )

  const waves = useMemo(
    () =>
      BAYS.map(() => {
        const NP = 72
        const arr = new Float32Array(NP * 3)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
        const mat = new THREE.LineBasicMaterial({ color: OK, toneMapped: false })
        const line = new THREE.Line(geo, mat)
        line.frustumCulled = false
        return { NP, arr, geo, mat, line }
      }),
    [],
  )

  const statusMats = useMemo(
    () => BAYS.map(() => new THREE.MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 2.6, toneMapped: false })),
    [],
  )
  const alarmMats = useMemo(
    () => BAYS.map(() => new THREE.MeshStandardMaterial({ color: DANGER, emissive: DANGER, emissiveIntensity: 0, toneMapped: false })),
    [],
  )
  const beaconMats = useMemo(
    () => [0, 1].map(() => new THREE.MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 2.5, toneMapped: false })),
    [],
  )
  const nurseScreenMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0a1f18', emissive: '#22c55e', emissiveIntensity: 1.5, toneMapped: false }),
    [],
  )

  // ── 反應式套色（隨遙測重繪；連續閃爍強度另於 useFrame 處理） ──
  useEffect(() => {
    statusMats.forEach((m) => {
      m.color.set(sevColor)
      m.emissive.set(sevColor)
    })
    beaconMats.forEach((m) => {
      m.color.set(sevColor)
      m.emissive.set(sevColor)
    })
  }, [sevColor, statusMats, beaconMats])

  useEffect(() => {
    drops.forEach((d) => (d.material as THREE.MeshStandardMaterial).color.set(fluidCol))
    drops.forEach((d) => (d.material as THREE.MeshStandardMaterial).emissive.set(fluidCol))
  }, [fluidCol, drops])

  useEffect(() => {
    const on = emergencyEnable
    nurseScreenMat.emissive.set(on ? '#22c55e' : '#ef4444')
    nurseScreenMat.color.set(on ? '#0a1f18' : '#2a0a0a')
  }, [emergencyEnable, nurseScreenMat])

  // ── 資源釋放 ──
  useEffect(
    () => () => {
      drops.forEach((d) => {
        d.geometry.dispose()
        ;(d.material as THREE.Material).dispose()
      })
      bubbles.forEach((b) => {
        b.geometry.dispose()
        ;(b.material as THREE.Material).dispose()
      })
      waves.forEach((w) => {
        w.geo.dispose()
        w.mat.dispose()
      })
      tubeGeo.dispose()
      statusMats.forEach((m) => m.dispose())
      alarmMats.forEach((m) => m.dispose())
      beaconMats.forEach((m) => m.dispose())
      nurseScreenMat.dispose()
    },
    [drops, bubbles, waves, tubeGeo, statusMats, alarmMats, beaconMats, nurseScreenMat],
  )

  // ── 單一動畫迴圈：落滴 / 氣泡 / 警報閃爍 / 燈塔脈動 / ECG 掃描 ──
  useFrame((state) => {
    const s = usePlantStore.getState().statuses['infusion'] as Record<string, number | boolean> | undefined
    const gn = (k: string, d: number): number => {
      const v = s?.[k]
      return typeof v === 'number' ? v : d
    }
    const gb = (k: string, d: boolean): boolean => {
      const v = s?.[k]
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : d
    }
    const expl = String(s?.explosionType ?? 'none')
    const fail = expl !== 'none'
    const run = gb('pumpRun', true) && gb('emergencyEnable', true)
    const flow = gn('flowRate', 100)
    const dpm = gn('dropRate', 0)
    const air = gn('airInLine', 0)
    const silence = gb('alarmSilence', false)
    const t = state.clock.elapsedTime

    // 落滴：速率 ∝ 滴速/輸注速率；阻塞 → 停滴
    const dripHz = run && expl !== 'occlusion' ? Math.max(dpm, flow * 0.15) / 60 : 0
    const dripping = dripHz > 0.01
    const top = 4.45
    const bot = 3.85
    for (let bi = 0; bi < drops.length; bi++) {
      const inst = drops[bi]
      for (let i = 0; i < DROPS; i++) {
        if (!dripping) {
          dummy.position.set(0, -100, 0)
          dummy.scale.setScalar(0)
        } else {
          const phase = (t * dripHz + i / DROPS + bi * 0.11) % 1
          dummy.position.set(0, top - phase * (top - bot), 0)
          dummy.scale.setScalar(1)
        }
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
    }

    // 氣泡：管路空氣高 或 空氣栓塞 → 沿管路衝向病患
    const bubbleOn = run && (air >= 15 || expl === 'airembolism')
    const bubbleHz = expl === 'airembolism' ? 0.5 : 0.18
    const bsize = expl === 'airembolism' ? 1.15 : Math.min(1, 0.35 + air / 120)
    for (let bi = 0; bi < bubbles.length; bi++) {
      const inst = bubbles[bi]
      for (let i = 0; i < BUBBLES; i++) {
        if (!bubbleOn) {
          dummy.position.set(0, -100, 0)
          dummy.scale.setScalar(0)
        } else {
          const p = (t * bubbleHz + i / BUBBLES + bi * 0.07) % 1
          tubeCurve.getPoint(p, tmpV)
          dummy.position.copy(tmpV)
          dummy.scale.setScalar(bsize)
        }
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
    }

    // 警報閃爍（靜音時隱藏 → 隱藏警報教學點）
    const alarmFlash = fail && !silence ? (Math.sin(t * 10) > 0 ? 3.6 : 0.15) : 0
    for (let i = 0; i < alarmMats.length; i++) alarmMats[i].emissiveIntensity = alarmFlash

    // 燈塔脈動（嚴重度越高脈動越強）
    let fsev = 0
    if (linePressure >= 5 || doseRateBody >= 8 || air >= 50 || reservoirLevel <= 8 || fail) fsev = 2
    else if (linePressure >= 3 || doseRateBody >= 5 || air >= 30 || reservoirLevel <= 20) fsev = 1
    const pulse = 2.2 + Math.sin(t * 4) * (fsev >= 2 ? 1.6 : fsev >= 1 ? 0.9 : 0.25)
    for (let i = 0; i < beaconMats.length; i++) beaconMats[i].emissiveIntensity = pulse

    // ECG：掃描；過量 → 紅色平線
    const flat = expl === 'overdose'
    for (let wi = 0; wi < waves.length; wi++) {
      const w = waves[wi]
      for (let i = 0; i < w.NP; i++) {
        const x = i / (w.NP - 1) - 0.5
        let y = 0
        if (!flat && run) {
          const u = (((i / w.NP) * 3 + t * 1.6 + wi * 0.2) % 1 + 1) % 1
          y = ecg(u) * 0.16
        }
        w.arr[i * 3] = x
        w.arr[i * 3 + 1] = y
        w.arr[i * 3 + 2] = 0
      }
      w.geo.attributes.position.needsUpdate = true
      w.mat.color.set(flat ? '#ef4444' : run ? '#34d399' : '#64748b')
    }
  })

  const displayColor = failing ? '#ef4444' : running ? '#22d3ee' : '#334155'
  const showClamp = explosionType === 'occlusion' || linePressure >= 5

  return (
    <group>
      {/* 背牆 */}
      <mesh position={[0, 2.4, -16]} castShadow receiveShadow>
        <boxGeometry args={[76, 4.8, 0.4]} />
        <M schematic={schematic} color="#cdd6df" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* 病床區 ×3（同一輸液線複製，讀取相同遙測；視覺相位微異） */}
      {BAYS.map((i) => {
        const frac = Math.max(0.04, Math.min(1, reservoirLevel / 100 + (i - 1) * 0.07))
        const bagBottom = 4.72
        const fluidH = 0.82
        return (
          <group key={i} position={[BAY_X[i], 0, 0]}>
            {/* 病房地墊 */}
            <mesh position={[0, 0.04, -0.3]} receiveShadow>
              <boxGeometry args={[8, 0.08, 8]} />
              <M schematic={schematic} color="#e0e8ee" metalness={0.05} roughness={0.8} />
            </mesh>

            <Bed schematic={schematic} />
            <IVPole schematic={schematic} />

            {/* 藥袋外殼 + 藥液（餘量→高度、濃度→染色） */}
            <group position={[-1.7, 0, -2.0]}>
              <mesh position={[0, 5.15, 0]} castShadow>
                <boxGeometry args={[0.52, 0.9, 0.16]} />
                <meshStandardMaterial color="#eef4f8" transparent opacity={schematic ? 0.28 : 0.32} metalness={0.0} roughness={0.2} toneMapped={false} />
              </mesh>
              <mesh position={[0, bagBottom + (fluidH * frac) / 2, 0]} scale={[1, frac, 1]}>
                <boxGeometry args={[0.46, fluidH, 0.12]} />
                <meshStandardMaterial color={fluidCol} emissive={fluidCol} emissiveIntensity={0.35} transparent opacity={0.9} metalness={0.0} roughness={0.25} toneMapped={false} />
              </mesh>
              {/* 滴注室 + 落滴 */}
              <mesh position={[0, 4.15, 0]}>
                <cylinderGeometry args={[0.09, 0.09, 0.7, 14]} />
                <meshStandardMaterial color="#dfe7ee" transparent opacity={0.25} metalness={0.0} roughness={0.15} toneMapped={false} />
              </mesh>
            </group>
            <primitive object={drops[i]} position={[-1.7, 0, -2.0]} />

            {/* 輸液幫浦（機身 + 顯示面板 + 狀態燈 + 警報燈） */}
            <group position={[-1.7, 2.6, -1.75]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.7, 0.95, 0.4]} />
                <M schematic={schematic} color="#eef1f4" metalness={0.2} roughness={0.5} />
              </mesh>
              {/* 顯示面板 */}
              <mesh position={[0, 0.12, 0.205]}>
                <planeGeometry args={[0.5, 0.32]} />
                <meshStandardMaterial color="#04121a" emissive={displayColor} emissiveIntensity={1.6} toneMapped={false} />
              </mesh>
              {/* 狀態燈（依嚴重度綠/黃/紅） */}
              <mesh position={[-0.18, -0.28, 0.21]} material={statusMats[i]}>
                <sphereGeometry args={[0.06, 14, 14]} />
              </mesh>
              {/* 警報燈（故障且未靜音 → 閃紅） */}
              <mesh position={[0.05, -0.28, 0.21]} material={alarmMats[i]}>
                <sphereGeometry args={[0.055, 14, 14]} />
              </mesh>
            </group>

            {/* 輸液管 + 空氣氣泡 + 阻塞夾（阻塞 / 高管壓時顯示） */}
            <mesh geometry={tubeGeo} castShadow>
              <meshStandardMaterial color="#e6edf3" transparent opacity={schematic ? 0.4 : 0.75} metalness={0.0} roughness={0.3} toneMapped={false} />
            </mesh>
            <primitive object={bubbles[i]} />
            {showClamp && (
              <mesh position={[-1.25, 1.85, -0.5]} rotation={[0, 0, 0.5]} castShadow>
                <boxGeometry args={[0.22, 0.12, 0.22]} />
                <meshStandardMaterial color={DANGER} emissive={DANGER} emissiveIntensity={2.4} toneMapped={false} />
              </mesh>
            )}

            {/* 生命徵象監視器（架 + 螢幕 + ECG 波形） */}
            <group position={[1.9, 0, 0.5]}>
              <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.35, 0.35, 0.08, 18]} />
                <M schematic={schematic} color="#8a939d" metalness={0.7} roughness={0.4} />
              </mesh>
              <mesh position={[0, 0.8, 0]} castShadow>
                <cylinderGeometry args={[0.05, 0.05, 1.5, 12]} />
                <M schematic={schematic} color="#b7bdc5" metalness={0.85} roughness={0.35} />
              </mesh>
              <mesh position={[0, 1.65, 0]} castShadow receiveShadow>
                <boxGeometry args={[1.05, 0.72, 0.12]} />
                <M schematic={schematic} color="#20262e" metalness={0.4} roughness={0.5} />
              </mesh>
              <mesh position={[0, 1.65, 0.065]}>
                <planeGeometry args={[0.92, 0.6]} />
                <meshStandardMaterial color="#020a10" emissive="#04121a" emissiveIntensity={0.6} toneMapped={false} />
              </mesh>
              <group position={[0, 1.65, 0.075]} scale={[0.84, 1, 1]}>
                <primitive object={waves[i].line} />
              </group>
            </group>

            {/* 隔簾軌 + 半開布簾 */}
            <mesh position={[3.3, 3.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 6.5, 10]} />
              <M schematic={schematic} color="#9aa3ad" metalness={0.8} roughness={0.35} />
            </mesh>
            <mesh position={[3.3, 2.2, -1.4]} castShadow>
              <planeGeometry args={[2.6, 2.7]} />
              <meshStandardMaterial color={schematic ? '#4a7fb5' : '#9fc2e0'} transparent opacity={schematic ? 0.3 : 0.82} roughness={0.9} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </group>
        )
      })}

      {/* 中央護理站 PLC 櫃（螢幕：運轉允許→綠、解除→紅） */}
      <group position={[0, 0, -13]}>
        <mesh position={[0, 1.7, 0]} castShadow receiveShadow>
          <boxGeometry args={[7, 3.2, 1.3]} />
          <M schematic={schematic} color="#37424f" metalness={0.55} roughness={0.45} />
        </mesh>
        <mesh position={[0, 2.0, 0.66]} material={nurseScreenMat}>
          <planeGeometry args={[2.6, 1.3]} />
        </mesh>
        {/* 桌面 */}
        <mesh position={[0, 0.92, 1.0]} castShadow receiveShadow>
          <boxGeometry args={[7, 0.12, 0.9]} />
          <M schematic={schematic} color="#5b6673" metalness={0.4} roughness={0.5} />
        </mesh>
        {/* 指示燈排 */}
        {[-1.0, -0.5, 0, 0.5, 1.0].map((lx, k) => (
          <mesh key={k} position={[lx, 2.85, 0.66]}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshStandardMaterial
              color={k % 2 === 0 ? '#22c55e' : '#38bdf8'}
              emissive={k % 2 === 0 ? '#22c55e' : '#38bdf8'}
              emissiveIntensity={2.4}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 警示燈塔 ×2（依全病房最壞嚴重度上色、脈動） */}
      {[
        [-30, 7],
        [30, 7],
      ].map(([bx, bz], k) => (
        <group key={k} position={[bx, 0, bz]}>
          <mesh position={[0, 1.5, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.12, 0.12, 3.0, 12]} />
            <M schematic={schematic} color="#8a939d" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 3.15, 0]} material={beaconMats[k]}>
            <sphereGeometry args={[0.34, 18, 18]} />
          </mesh>
        </group>
      ))}

      <Html position={[0, 9, 6]} center distanceFactor={70} style={{ pointerEvents: 'none' }}>
        <div className="twin-title">輸液幫浦病房{failing ? ' · 故障' : ''}</div>
      </Html>
    </group>
  )
}
