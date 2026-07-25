// ============================================================
// 核磁共振 MRI — 專屬寫實 3D 場景（安全 PLC 由即時 Modbus 遙測驅動）
//   場景要素：主磁體孔徑掃描儀、病床進出、冷卻/液氦機組、失超排氣煙囪、
//   控制室窗+控制台、屏蔽門+互鎖警示燈、磁場環、梯度線圈脈動、狀態警示燈。
//   所有動畫集中於單一 useFrame；useFrame 內以 getState() 讀取最新遙測，絕不 setState。
// ============================================================

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { usePlantStore } from '../store/usePlantStore'

// ── 危險配色（父層 Bloom 生效，發光燈強度 2–4） ──
const OK = '#34d399'
const WARN = '#fbbf24'
const DANGER = '#fb4268'
const CALM = '#7fd6ff'

type Rec = Record<string, number | boolean> | undefined

// 幀內重用的暫存物件（避免每幀配置）
const _col = new THREE.Color()
const _dummy = new THREE.Object3D()

const lerp = THREE.MathUtils.lerp
const clamp = THREE.MathUtils.clamp

function num(s: Rec, k: string, d: number): number {
  const v = s?.[k]
  return typeof v === 'number' ? v : d
}
function truthy(v: number | boolean | undefined): boolean {
  return v === true || (typeof v === 'number' && v !== 0)
}
// 依整體最嚴重通道回傳嚴重度 0/1/2
function severityOf(s: Rec): 0 | 1 | 2 {
  let sev = 0
  const bump = (x: number) => {
    if (x > sev) sev = x
  }
  const mt = num(s, 'magnetTemp', 4.2)
  bump(mt >= 6 ? 2 : mt >= 5 ? 1 : 0)
  const sar = num(s, 'sarValue', 0)
  bump(sar >= 4 ? 2 : sar >= 2 ? 1 : 0)
  const gt = num(s, 'gradientTemp', 0)
  bump(gt >= 80 ? 2 : gt >= 60 ? 1 : 0)
  const cf = num(s, 'coolingFlow', 60)
  bump(cf <= 15 ? 2 : cf <= 30 ? 1 : 0)
  const he = num(s, 'heliumLevel', 100)
  bump(he <= 40 ? 2 : he <= 60 ? 1 : 0)
  if (num(s, 'doorBreach', 0) >= 1) bump(2)
  return sev as 0 | 1 | 2
}
function sevColor(sev: number): string {
  return sev >= 2 ? DANGER : sev >= 1 ? WARN : OK
}

// ── 材質輔助：寫實=金屬實心，示意=半透明全像 ──
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

// ── 小型浮動標籤 ──
function Label({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Html position={position} center distanceFactor={82} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          color: '#bfe9ff',
          font: '600 12px system-ui, sans-serif',
          whiteSpace: 'nowrap',
          letterSpacing: '0.04em',
          textShadow: '0 0 8px rgba(2,18,32,0.9)',
          opacity: 0.85,
        }}
      >
        {text}
      </div>
    </Html>
  )
}

// 場景常數（硬編碼區域座標，足跡約 52m×40m）
const HB = 3.9 // 磁體垂直中心
const VENT_X = 8
const VENT_Z = -5
const VENT_TOP = 20.5
const CH_X = -16 // 冷卻機
const HE_X = -16 // 液氦槽
const HE_Z = 9
const HE_BOT = 0.4
const HE_H = 7
const TABLE_PARK = 12 // 病床停放（伸出）
const TABLE_IN = 2 // 病床進入孔徑
const PARTS = 46 // 失超蒸氣粒子數

export function MRIScene({ schematic }: { schematic: boolean }) {
  // 反應式讀取（供標題與初始渲染）
  const st = usePlantStore((s) => s.statuses['mri']) as Rec
  const failing = String(st?.explosionType ?? 'none') !== 'none'

  // 動畫 refs（幀內以 ref 直接變更材質/位移，不 setState）
  const tableRef = useRef<THREE.Group>(null)
  const fanRef = useRef<THREE.Group>(null)
  const boreRingMat = useRef<THREE.MeshStandardMaterial>(null)
  const boreLight = useRef<THREE.PointLight>(null)
  const fieldRingRef = useRef<THREE.Mesh>(null)
  const fieldRingMat = useRef<THREE.MeshBasicMaterial>(null)
  const gradMats = useRef<THREE.MeshStandardMaterial[]>([])
  const heFillRef = useRef<THREE.Mesh>(null)
  const heFillMat = useRef<THREE.MeshStandardMaterial>(null)
  const magLampMat = useRef<THREE.MeshStandardMaterial>(null)
  const screenMat = useRef<THREE.MeshStandardMaterial>(null)
  const doorPanelRef = useRef<THREE.Group>(null)
  const doorBeaconMat = useRef<THREE.MeshStandardMaterial>(null)
  const doorBeaconLight = useRef<THREE.PointLight>(null)
  const ferroRef = useRef<THREE.Group>(null)
  const beaconMats = useRef<THREE.MeshStandardMaterial[]>([])
  const vaporRef = useRef<THREE.InstancedMesh>(null)

  // 粒子基礎資料（穩定不變）
  const particles = useMemo(
    () =>
      Array.from({ length: PARTS }, () => ({
        ang: Math.random() * Math.PI * 2,
        rad: 0.2 + Math.random() * 1.6,
        speed: 1.6 + Math.random() * 3.4,
        phase: Math.random(),
        scale: 1.1 + Math.random() * 2.6,
      })),
    [],
  )

  useFrame((state, dt) => {
    const s = usePlantStore.getState().statuses['mri'] as Rec
    const t = state.clock.elapsedTime
    const d = Math.min(dt, 0.05)

    const explosion = String(s?.explosionType ?? 'none')
    const permit = !(s?.emergencyEnable === false || s?.emergencyEnable === 0)
    const cryoRun = truthy(s?.cryoCoolerRun)
    const locked = s?.doorInterlock !== false && s?.doorInterlock !== 0
    const scanning = cryoRun && permit

    const coolingFlow = num(s, 'coolingFlow', 60)
    const rfPower = num(s, 'rfPower', 100)
    const gradientDuty = num(s, 'gradientDuty', 70)
    const gradientTemp = num(s, 'gradientTemp', 30)
    const magnetTemp = num(s, 'magnetTemp', 4.2)
    const heliumLevel = num(s, 'heliumLevel', 100)
    const sarValue = num(s, 'sarValue', 0)
    const quenchPressure = num(s, 'quenchPressure', 0)
    const fieldStrength = num(s, 'fieldStrength', 3.0)
    const doorBreach = num(s, 'doorBreach', 0)

    const quenching = explosion === 'quench' || magnetTemp >= 6 || quenchPressure >= 3
    const breach = !locked || doorBreach >= 1 || explosion === 'projectile'
    const sev = severityOf(s)

    // 梯度脈動基底（掃描時依 gradientDuty 加速）
    const grRate = scanning ? 2 + gradientDuty * 0.06 : 0.4
    const grPulse = 0.5 + 0.5 * Math.sin(t * grRate)

    // ── 病床沿孔徑軸滑動（掃描時循環進出，停機停靠伸出位）──
    if (tableRef.current) {
      const cyc = (Math.sin(t * 0.32 - Math.PI / 2) + 1) / 2 // 0..1 平滑
      const target = scanning ? lerp(TABLE_PARK, TABLE_IN, cyc) : TABLE_PARK
      tableRef.current.position.z = lerp(tableRef.current.position.z, target, d * 2.2)
    }

    // ── 冷卻機風扇：轉速 ∝ coolingFlow，cryoCoolerRun 關則停 ──
    if (fanRef.current) {
      const fanSpeed = cryoRun ? (0.12 + (coolingFlow / 100) * 0.88) * 11 : 0
      fanRef.current.rotation.x += d * fanSpeed
    }

    // ── 孔徑環燈：正常藍白，SAR/RF 高→琥珀/紅，失超→熄暗 ──
    const sarSev = explosion === 'sarburn' ? 2 : sarValue >= 4 ? 2 : sarValue >= 2 || rfPower >= 130 ? 1 : 0
    let ringInt: number
    if (quenching) {
      _col.set('#5a6f7d')
      ringInt = 0.25
    } else if (sarSev >= 2) {
      _col.set(DANGER)
      ringInt = 3.4
    } else if (sarSev >= 1) {
      _col.set(WARN)
      ringInt = 2.4
    } else {
      _col.set(CALM)
      ringInt = 1.9
    }
    ringInt *= 0.78 + 0.22 * (scanning ? grPulse : 0.5)
    if (boreRingMat.current) {
      boreRingMat.current.color.copy(_col)
      boreRingMat.current.emissive.copy(_col)
      boreRingMat.current.emissiveIntensity = ringInt
    }
    if (boreLight.current) {
      boreLight.current.color.copy(_col)
      boreLight.current.intensity = quenching ? 0.2 : 1.6 + ringInt * 0.4
    }

    // ── 磁場環：半徑/透明度暗示 fieldStrength，失超時收縮淡出 ──
    const fieldFrac = clamp(fieldStrength / 3.0, 0, 1.15)
    const ringScale = quenching ? 0.42 : 0.58 + 0.5 * fieldFrac
    const ringOpacity = quenching ? 0.05 : 0.09 + 0.34 * fieldFrac
    if (fieldRingRef.current) {
      const cs = fieldRingRef.current.scale.x
      const nsx = lerp(cs, ringScale, d * 2.5)
      fieldRingRef.current.scale.set(nsx, 1, nsx)
    }
    if (fieldRingMat.current) {
      fieldRingMat.current.opacity = lerp(fieldRingMat.current.opacity, ringOpacity, d * 2.5)
    }

    // ── 梯度線圈：脈動發光；gradientTemp 高→琥珀/紅 ──
    _col.set(gradientTemp >= 80 ? DANGER : gradientTemp >= 60 ? WARN : '#38bdf8')
    const gcInt = scanning ? 0.55 + grPulse * 1.9 : 0.22
    for (const m of gradMats.current) {
      if (!m) continue
      m.emissive.copy(_col)
      m.emissiveIntensity = gcInt
    }

    // ── 液氦液位計：填充 ∝ heliumLevel，低位變色 ──
    const heFrac = clamp(heliumLevel / 100, 0.02, 1)
    if (heFillRef.current) {
      heFillRef.current.scale.y = heFrac
      heFillRef.current.position.y = HE_BOT + (HE_H * heFrac) / 2
    }
    if (heFillMat.current) {
      _col.set(heliumLevel <= 40 ? DANGER : heliumLevel <= 60 ? WARN : '#5fd0ff')
      heFillMat.current.color.copy(_col)
      heFillMat.current.emissive.copy(_col)
      heFillMat.current.emissiveIntensity = 1.4
    }

    // ── 磁體溫度指示燈 ──
    if (magLampMat.current) {
      _col.set(magnetTemp >= 6 ? DANGER : magnetTemp >= 5 ? WARN : OK)
      magLampMat.current.color.copy(_col)
      magLampMat.current.emissive.copy(_col)
      magLampMat.current.emissiveIntensity = magnetTemp >= 6 ? 2.6 + Math.sin(t * 8) * 0.8 : 2.3
    }

    // ── 控制台螢幕：無運轉允許→轉紅閃爍 ──
    if (screenMat.current) {
      if (!permit) {
        _col.set(DANGER)
        screenMat.current.emissiveIntensity = 2.2 + Math.sin(t * 7) * 1.2
      } else {
        _col.set('#2aa9e0')
        screenMat.current.emissiveIntensity = 1.8 + Math.sin(t * 1.5) * 0.25
      }
      screenMat.current.color.copy(_col)
      screenMat.current.emissive.copy(_col)
    }

    // ── 屏蔽門互鎖燈：安全鎖定→綠，破壞/投射→紅閃並半開門 ──
    if (doorBeaconMat.current) {
      if (breach) {
        _col.set(DANGER)
        doorBeaconMat.current.emissiveIntensity = 2.2 + (0.5 + 0.5 * Math.sin(t * 10)) * 2
      } else {
        _col.set(OK)
        doorBeaconMat.current.emissiveIntensity = 2.4
      }
      doorBeaconMat.current.color.copy(_col)
      doorBeaconMat.current.emissive.copy(_col)
    }
    if (doorBeaconLight.current) {
      doorBeaconLight.current.color.set(breach ? DANGER : OK)
      doorBeaconLight.current.intensity = breach ? 1.6 + Math.sin(t * 10) * 1.2 : 0.9
    }
    if (doorPanelRef.current) {
      const ajar = breach ? 4.6 : 2 // 沿 Z 半開
      doorPanelRef.current.position.z = lerp(doorPanelRef.current.position.z, ajar, d * 3)
    }

    // ── 鐵磁投射物（gas cylinder）：projectile 時朝孔徑飛入 ──
    if (ferroRef.current) {
      if (explosion === 'projectile') {
        ferroRef.current.position.x = lerp(ferroRef.current.position.x, 0.6, d * 3.2)
        ferroRef.current.position.z = lerp(ferroRef.current.position.z, 5, d * 3.2)
        ferroRef.current.rotation.z += d * 7
      } else {
        ferroRef.current.position.x = lerp(ferroRef.current.position.x, 14, d * 2)
        ferroRef.current.position.z = lerp(ferroRef.current.position.z, 12, d * 2)
        ferroRef.current.rotation.z = lerp(ferroRef.current.rotation.z, Math.PI / 2, d * 2)
      }
    }

    // ── 狀態警示燈（依整體嚴重度） ──
    _col.set(sevColor(sev))
    for (const m of beaconMats.current) {
      if (!m) continue
      m.color.copy(_col)
      m.emissive.copy(_col)
      m.emissiveIntensity = sev >= 2 ? 2 + (0.5 + 0.5 * Math.sin(t * 9)) * 2 : sev >= 1 ? 2.3 : 1.6
    }

    // ── 失超蒸氣：instancedMesh 白色霧球自排氣口翻騰上升；未觸發縮至 0 ──
    const inst = vaporRef.current
    if (inst) {
      if (quenching) {
        for (let i = 0; i < PARTS; i++) {
          const p = particles[i]
          const life = (t * p.speed * 0.12 + p.phase) % 1
          const rise = life * 15
          const spread = p.rad + life * 3.2
          _dummy.position.set(
            VENT_X + Math.cos(p.ang) * spread,
            VENT_TOP + rise,
            VENT_Z + Math.sin(p.ang) * spread,
          )
          const sc = p.scale * (0.4 + life * 1.5) * (1 - life * 0.28)
          _dummy.scale.setScalar(Math.max(0.001, sc))
          _dummy.rotation.set(life * 3, p.ang, life * 2)
          _dummy.updateMatrix()
          inst.setMatrixAt(i, _dummy.matrix)
        }
      } else {
        _dummy.scale.setScalar(0)
        _dummy.updateMatrix()
        for (let i = 0; i < PARTS; i++) inst.setMatrixAt(i, _dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      {/* ── 套房地坪（父層另有共用地面 y=0；此為淺色 RF 屏蔽室地板） ── */}
      <mesh position={[0, 0.05, 1]} receiveShadow>
        <boxGeometry args={[56, 0.1, 42]} />
        <M schematic={schematic} color={schematic ? '#0b1a2c' : '#182530'} metalness={0.3} roughness={0.75} />
      </mesh>
      {/* 地面 5 高斯警戒環標線 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <ringGeometry args={[12.6, 13.2, 72]} />
        <meshBasicMaterial color={WARN} transparent opacity={0.5} toneMapped={false} />
      </mesh>

      {/* ============ 主磁體 / 孔徑掃描儀 ============ */}
      <group position={[0, HB, 0]}>
        {/* 外殼（開端圓筒） */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[5, 5, 8, 56, 1, true]} />
          <M schematic={schematic} color={schematic ? '#3aa0d8' : '#e8e4dc'} metalness={0.25} roughness={0.45} />
        </mesh>
        {/* 前面板（環形，中央為孔洞） */}
        <mesh position={[0, 0, 4.02]} castShadow>
          <ringGeometry args={[2.05, 5, 56]} />
          <M schematic={schematic} color={schematic ? '#4bb2e6' : '#f2efe9'} metalness={0.2} roughness={0.5} />
        </mesh>
        {/* 後面板（封閉環，避免穿透） */}
        <mesh position={[0, 0, -4.02]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[5, 56]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#cfc9bf'} metalness={0.2} roughness={0.6} />
        </mesh>
        {/* 孔徑內壁（深色隧道） */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2, 2, 8.1, 40, 1, true]} />
          <meshStandardMaterial color="#0d1319" side={THREE.BackSide} metalness={0.1} roughness={0.9} />
        </mesh>
        {/* 前緣圓邊斜面 */}
        <mesh position={[0, 0, 4]}>
          <torusGeometry args={[5, 0.4, 16, 56]} />
          <M schematic={schematic} color={schematic ? '#5bbff0' : '#d9d4ca'} metalness={0.3} roughness={0.4} />
        </mesh>

        {/* 孔徑環燈（顏色/強度 ∝ rfPower/sarValue；失超熄暗） */}
        <mesh position={[0, 0, 4.12]}>
          <torusGeometry args={[2.3, 0.2, 18, 60]} />
          <meshStandardMaterial ref={boreRingMat} color={CALM} emissive={CALM} emissiveIntensity={1.9} toneMapped={false} />
        </mesh>
        <pointLight ref={boreLight} position={[0, 0, 5]} color={CALM} intensity={1.8} distance={16} decay={2} />

        {/* 梯度線圈指示帶（脈動 ∝ gradientDuty；gradientTemp 高變色） */}
        {[-2.1, 0, 2.1].map((zz, i) => (
          <mesh key={zz} position={[0, 0, zz]}>
            <torusGeometry args={[5.08, 0.12, 12, 56]} />
            <meshStandardMaterial
              ref={(m) => {
                if (m) gradMats.current[i] = m
              }}
              color="#38bdf8"
              emissive="#38bdf8"
              emissiveIntensity={0.6}
              toneMapped={false}
            />
          </mesh>
        ))}

        {/* 頂部銘牌燈條 */}
        <mesh position={[0, 4.2, 0]} castShadow>
          <boxGeometry args={[3, 0.5, 6]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#2f3a44'} metalness={0.4} roughness={0.4} />
        </mesh>
      </group>

      {/* ── 磁場環（faint torus，radius/opacity ∝ fieldStrength） ── */}
      <mesh ref={fieldRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <torusGeometry args={[9, 0.16, 12, 80]} />
        <meshBasicMaterial ref={fieldRingMat} color="#67e8f9" transparent opacity={0.32} toneMapped={false} />
      </mesh>

      {/* ============ 病床（沿孔徑軸進出） ============ */}
      {/* 固定底座 */}
      <mesh position={[0, 1.4, 13]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 2.8, 2.4]} />
        <M schematic={schematic} color={schematic ? '#2b6f96' : '#3a4650'} metalness={0.5} roughness={0.45} />
      </mesh>
      <group ref={tableRef} position={[0, 0, TABLE_PARK]}>
        {/* 床板 */}
        <mesh position={[0, 2.9, 0]} castShadow>
          <boxGeometry args={[2.4, 0.25, 9]} />
          <M schematic={schematic} color={schematic ? '#7fd6ff' : '#e6ecf2'} metalness={0.2} roughness={0.4} />
        </mesh>
        {/* 兩側導軌 */}
        {[-1.05, 1.05].map((xx) => (
          <mesh key={xx} position={[xx, 2.75, 0]} castShadow>
            <boxGeometry args={[0.18, 0.28, 8.6]} />
            <M schematic={schematic} color={schematic ? '#3aa0d8' : '#98a4b0'} metalness={0.7} roughness={0.3} />
          </mesh>
        ))}
        {/* 病患（毛毯膠囊，位於床前端先入孔） */}
        <mesh position={[0, 3.35, -2.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.7, 3.2, 6, 16]} />
          <M schematic={schematic} color={schematic ? '#5bbff0' : '#6aa7d8'} metalness={0.05} roughness={0.85} />
        </mesh>
        {/* 頭枕 */}
        <mesh position={[0, 3.4, -4.4]} castShadow>
          <boxGeometry args={[1, 0.3, 0.8]} />
          <M schematic={schematic} color={schematic ? '#7fd6ff' : '#d7dee6'} metalness={0.1} roughness={0.7} />
        </mesh>
      </group>

      {/* ============ 冷卻 / 冷卻機組 ============ */}
      <group position={[CH_X, 0, 0]}>
        {/* 機箱 */}
        <mesh position={[0, 3, 0]} castShadow receiveShadow>
          <boxGeometry args={[4.4, 6, 5]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#c7d0d8'} metalness={0.45} roughness={0.5} />
        </mesh>
        {/* 面板細節 */}
        <mesh position={[0, 3, 2.55]} castShadow>
          <boxGeometry args={[3.6, 5, 0.15]} />
          <M schematic={schematic} color={schematic ? '#3aa0d8' : '#8b97a3'} metalness={0.5} roughness={0.4} />
        </mesh>
        {/* 磁體溫度指示燈 */}
        <mesh position={[1.4, 5.1, 2.65]}>
          <sphereGeometry args={[0.32, 20, 20]} />
          <meshStandardMaterial ref={magLampMat} color={OK} emissive={OK} emissiveIntensity={2.3} toneMapped={false} />
        </mesh>

        {/* 進氣格柵（面向掃描儀 +X） */}
        <mesh position={[2.15, 4, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[1.5, 0.16, 12, 40]} />
          <M schematic={schematic} color={schematic ? '#5bbff0' : '#6b7681'} metalness={0.6} roughness={0.4} />
        </mesh>
        {/* 風扇（轉速 ∝ coolingFlow，cryoCoolerRun 關則停） */}
        <group ref={fanRef} position={[2.2, 4, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.35, 0.35, 0.4, 16]} />
            <M schematic={schematic} color={schematic ? '#7fd6ff' : '#4a5560'} metalness={0.7} roughness={0.3} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <group key={i} rotation={[(i * Math.PI) / 2, 0, 0]}>
              <mesh position={[0, 1.05, 0]} rotation={[0.4, 0, 0]} castShadow>
                <boxGeometry args={[0.12, 2, 0.6]} />
                <M schematic={schematic} color={schematic ? '#5bbff0' : '#aeb8c2'} metalness={0.5} roughness={0.4} />
              </mesh>
            </group>
          ))}
        </group>
      </group>

      {/* ── 液氦槽 + 液位計（fill ∝ heliumLevel） ── */}
      <group position={[HE_X, 0, HE_Z]}>
        <mesh position={[0, HE_BOT + HE_H / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.4, 1.4, HE_H, 28]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#b9c2cb'} metalness={0.7} roughness={0.3} />
        </mesh>
        {/* 透明液位視窗外框 */}
        <mesh position={[0, HE_BOT + HE_H / 2, 1.28]}>
          <boxGeometry args={[0.5, HE_H - 0.6, 0.12]} />
          <meshStandardMaterial color="#1a2530" metalness={0.3} roughness={0.6} />
        </mesh>
        {/* 液位填充條（scale.y ∝ heliumLevel） */}
        <mesh ref={heFillRef} position={[0, HE_BOT + HE_H / 2, 1.34]} scale={[1, 1, 1]}>
          <boxGeometry args={[0.34, HE_H - 0.6, 0.06]} />
          <meshStandardMaterial ref={heFillMat} color="#5fd0ff" emissive="#5fd0ff" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        <mesh position={[0, HE_BOT + HE_H + 0.4, 0]} castShadow>
          <sphereGeometry args={[1.45, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <M schematic={schematic} color={schematic ? '#3aa0d8' : '#9aa6b2'} metalness={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* ============ 失超排氣煙囪 + 蒸氣 ============ */}
      <group position={[VENT_X, 0, VENT_Z]}>
        <mesh position={[0, HB + 4, 0]} castShadow>
          <boxGeometry args={[2.4, 2.4, 2.4]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#7c8791'} metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[0, (HB + 5.2 + VENT_TOP) / 2, 0]} castShadow>
          <cylinderGeometry args={[0.9, 0.9, VENT_TOP - (HB + 5.2), 20]} />
          <M schematic={schematic} color={schematic ? '#3aa0d8' : '#9aa6b2'} metalness={0.65} roughness={0.35} />
        </mesh>
        {/* 排氣頂帽 */}
        <mesh position={[0, VENT_TOP + 0.2, 0]} castShadow>
          <cylinderGeometry args={[1.4, 1.1, 0.9, 20]} />
          <M schematic={schematic} color={schematic ? '#5bbff0' : '#6b7681'} metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
      {/* 失超蒸氣雲（instancedMesh；未觸發縮至 0） */}
      <instancedMesh ref={vaporRef} args={[undefined, undefined, PARTS]} frustumCulled={false}>
        <sphereGeometry args={[0.9, 12, 12]} />
        <meshStandardMaterial
          color="#f4f8ff"
          emissive="#dfeaff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.5}
          roughness={1}
          metalness={0}
          depthWrite={false}
        />
      </instancedMesh>

      {/* ============ 控制室（低牆 + 觀察窗 + 控制台） ============ */}
      <group position={[0, 0, -16]}>
        {/* 窗台實牆 */}
        <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[28, 2.6, 0.4]} />
          <M schematic={schematic} color={schematic ? '#123047' : '#26333d'} metalness={0.3} roughness={0.6} />
        </mesh>
        {/* 觀察玻璃窗 */}
        <mesh position={[0, 4, 0]}>
          <boxGeometry args={[24, 3, 0.12]} />
          <meshStandardMaterial color="#bfe9ff" transparent opacity={0.16} metalness={0.1} roughness={0.05} />
        </mesh>
        {/* 窗框上樑 + 立柱 */}
        <mesh position={[0, 5.7, 0]} castShadow>
          <boxGeometry args={[28, 0.5, 0.5]} />
          <M schematic={schematic} color={schematic ? '#2b6f96' : '#3a4650'} metalness={0.5} roughness={0.4} />
        </mesh>
        {[-12, 0, 12].map((xx) => (
          <mesh key={xx} position={[xx, 4, 0]} castShadow>
            <boxGeometry args={[0.4, 3, 0.4]} />
            <M schematic={schematic} color={schematic ? '#2b6f96' : '#3a4650'} metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {/* 控制台桌 */}
        <mesh position={[0, 1.5, 2.6]} castShadow receiveShadow>
          <boxGeometry args={[7, 0.3, 2]} />
          <M schematic={schematic} color={schematic ? '#123047' : '#2a3946'} metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.75, 2.6]} castShadow>
          <boxGeometry args={[6.6, 1.5, 1.6]} />
          <M schematic={schematic} color={schematic ? '#0e2033' : '#1f2b35'} metalness={0.3} roughness={0.6} />
        </mesh>
        {/* 監視器外框 */}
        <mesh position={[0, 3, 2.9]} castShadow>
          <boxGeometry args={[4, 2.4, 0.25]} />
          <M schematic={schematic} color={schematic ? '#0e2033' : '#161f27'} metalness={0.3} roughness={0.5} />
        </mesh>
        {/* 螢幕（emergencyEnable=false → 轉紅） */}
        <mesh position={[0, 3, 3.04]}>
          <planeGeometry args={[3.6, 2]} />
          <meshStandardMaterial ref={screenMat} color="#2aa9e0" emissive="#2aa9e0" emissiveIntensity={1.8} toneMapped={false} />
        </mesh>
      </group>

      {/* ============ 屏蔽門 + 互鎖警示燈 ============ */}
      <group position={[21, 0, 0]}>
        {/* 門框：左右實牆段 + 上楣 */}
        <mesh position={[0, 3, -3.25]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 6, 6.5]} />
          <M schematic={schematic} color={schematic ? '#123047' : '#2c3b46'} metalness={0.3} roughness={0.6} />
        </mesh>
        <mesh position={[0, 3, 6.75]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 6, 6.5]} />
          <M schematic={schematic} color={schematic ? '#123047' : '#2c3b46'} metalness={0.3} roughness={0.6} />
        </mesh>
        <mesh position={[0, 5.3, 2]} castShadow>
          <boxGeometry args={[0.5, 1.4, 3.2]} />
          <M schematic={schematic} color={schematic ? '#123047' : '#2c3b46'} metalness={0.3} roughness={0.6} />
        </mesh>
        {/* 門扇（互鎖失效時半開） */}
        <group ref={doorPanelRef} position={[0, 0, 2]}>
          <mesh position={[-0.1, 2.2, 0]} castShadow>
            <boxGeometry args={[0.3, 4.2, 2.9]} />
            <M schematic={schematic} color={schematic ? '#3aa0d8' : '#5b6b78'} metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[-0.28, 2.2, -1.1]} castShadow>
            <boxGeometry args={[0.1, 0.7, 0.15]} />
            <M schematic={schematic} color={schematic ? '#7fd6ff' : '#c2ccd4'} metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
        {/* 互鎖警示燈（門楣上方） */}
        <mesh position={[-0.4, 5.4, 2]}>
          <sphereGeometry args={[0.45, 20, 20]} />
          <meshStandardMaterial ref={doorBeaconMat} color={OK} emissive={OK} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
        <pointLight ref={doorBeaconLight} position={[-1, 5.4, 2]} color={OK} intensity={0.9} distance={10} decay={2} />
        {/* 5 高斯磁場警示牌 */}
        <mesh position={[-0.32, 3, 6.6]}>
          <boxGeometry args={[0.1, 1.4, 1.4]} />
          <meshStandardMaterial color={WARN} emissive={WARN} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        <mesh position={[-0.4, 3, 6.6]}>
          <boxGeometry args={[0.06, 1.0, 1.0]} />
          <meshStandardMaterial color="#111318" emissive="#111318" emissiveIntensity={0.1} />
        </mesh>
      </group>

      {/* ── 鐵磁投射物（O2 鋼瓶；projectile 時飛向孔徑） ── */}
      <group ref={ferroRef} position={[14, 0, 12]} rotation={[0, 0, Math.PI / 2]}>
        <mesh position={[0, 1.6, 0]} castShadow>
          <cylinderGeometry args={[0.55, 0.55, 3.2, 20]} />
          <M schematic={schematic} color={schematic ? '#5bbff0' : '#3f6f4a'} metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[0, 3.35, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.4, 0.6, 16]} />
          <M schematic={schematic} color={schematic ? '#7fd6ff' : '#7c8791'} metalness={0.85} roughness={0.3} />
        </mesh>
      </group>

      {/* ── 狀態警示燈柱（依整體嚴重度） ── */}
      {[-25, 25].map((xx, i) => (
        <group key={xx} position={[xx, 0, 15]}>
          <mesh position={[0, 2.5, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 5, 12]} />
            <M schematic={schematic} color={schematic ? '#2b6f96' : '#48535d'} metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 5.3, 0]}>
            <sphereGeometry args={[0.6, 20, 20]} />
            <meshStandardMaterial
              ref={(m) => {
                if (m) beaconMats.current[i] = m
              }}
              color={OK}
              emissive={OK}
              emissiveIntensity={1.6}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* ── 子系統標籤 ── */}
      <Label position={[CH_X, 7.2, 0]} text="冷卻機 Chiller" />
      <Label position={[HE_X, HE_H + 2.6, HE_Z]} text="液氦槽 He" />
      <Label position={[VENT_X, VENT_TOP + 1.8, VENT_Z]} text="失超排氣 Quench Vent" />
      <Label position={[0, 7.4, -16]} text="控制室 Console" />
      <Label position={[21, 7, 2]} text="屏蔽門 Interlock" />
      <Label position={[0, 10.4, 0]} text="主磁體 Bore" />

      {/* ── 孿生標題（規範結尾） ── */}
      <Html position={[0, 13.5, 0]} center distanceFactor={80} style={{ pointerEvents: 'none' }}>
        <div className="twin-title">核磁共振 MRI{failing ? ' · 故障' : ''}</div>
      </Html>
    </group>
  )
}
