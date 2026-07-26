import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { usePlantStore } from '../store/usePlantStore'
import type { HospitalFacility, HospitalLevel } from '../types/telemetry'

interface NodeMeta {
  id: string
  label: string
  zone: string
  position: [number, number, number]
  size: [number, number, number]
  kind: 'gateway' | 'workstation' | 'data' | 'hl7' | 'ris' | 'mri' | 'pacs' | 'runner' | 'bms' | 'chiller'
}

const NODES: NodeMeta[] = [
  { id: 'vendor-entry', label: '廠商入口', zone: 'DMZ', position: [-43, 2.8, -27], size: [12, 5.6, 10], kind: 'gateway' },
  { id: 'biomed-ws', label: '醫工工作站', zone: '臨床區', position: [-21, 3.5, -20], size: [12, 7, 10], kind: 'workstation' },
  { id: 'ehr-fhir', label: 'EHR / FHIR', zone: '臨床區', position: [0, 4, -26], size: [13, 8, 10], kind: 'data' },
  { id: 'hl7-engine', label: 'HL7 Engine', zone: '整合區', position: [-24, 4, 2], size: [13, 8, 10], kind: 'hl7' },
  { id: 'ris-mwl', label: 'RIS / MWL', zone: '整合區', position: [-4, 4, 4], size: [13, 8, 10], kind: 'ris' },
  { id: 'mri-sim', label: 'MRI Simulator', zone: '影像區', position: [23, 4.5, -4], size: [16, 9, 13], kind: 'mri' },
  { id: 'pacs', label: 'PACS / Orthanc', zone: '影像區', position: [47, 5, -10], size: [14, 10, 11], kind: 'pacs' },
  { id: 'protocol-runner', label: 'Protocol Runner', zone: 'OT 區', position: [-10, 4, 29], size: [14, 8, 10], kind: 'runner' },
  { id: 'bms', label: 'BMS', zone: 'OT 區', position: [15, 4, 27], size: [12, 8, 10], kind: 'bms' },
  { id: 'chiller-sim', label: 'Chiller / BACnet', zone: 'OT 區', position: [39, 3.5, 27], size: [15, 7, 11], kind: 'chiller' },
]

const NODE_MAP = Object.fromEntries(NODES.map((node) => [node.id, node]))

const CLINICAL_FLOW = ['hl7-engine', 'ris-mwl', 'mri-sim', 'pacs', 'ehr-fhir']
const COOLING_FLOW = ['chiller-sim', 'bms', 'mri-sim']
const ATTACK_FLOW = ['vendor-entry', 'biomed-ws', 'hl7-engine']

const STATUS_COLOR: Record<HospitalLevel, string> = {
  ok: '#34d399',
  alarm: '#fb4268',
  offline: '#51607a',
}

function statusFor(facility?: HospitalFacility): HospitalLevel {
  return facility?.level ?? 'offline'
}

function ZonePad({
  position,
  size,
  color,
}: {
  position: [number, number, number]
  size: [number, number]
  color: string
}) {
  return (
    <mesh position={position} receiveShadow>
      <boxGeometry args={[size[0], 0.45, size[1]]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.14} transparent opacity={0.68} />
    </mesh>
  )
}

function AlarmPulse({ radius }: { radius: number }) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!ref.current) return
    const phase = (clock.elapsedTime * 0.85) % 1
    ref.current.scale.setScalar(0.75 + phase * 0.75)
    const material = ref.current.material as THREE.MeshBasicMaterial
    material.opacity = (1 - phase) * 0.55
  })

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
      <ringGeometry args={[radius, radius + 0.55, 48]} />
      <meshBasicMaterial color="#fb4268" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function MiniModel({
  meta,
  schematic,
  selected,
  statusColor,
}: {
  meta: NodeMeta
  schematic: boolean
  selected: boolean
  statusColor: string
}) {
  const body = selected ? '#b9efff' : schematic ? '#0b2740' : '#cad8df'
  const material = <meshStandardMaterial color={body} emissive={statusColor} emissiveIntensity={schematic ? 0.28 : 0.06} roughness={0.42} metalness={0.32} />
  const glow = <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.8} toneMapped={false} />

  if (meta.kind === 'gateway') {
    return (
      <group>
        {[-4, 4].map((x) => <mesh key={x} position={[x, 0, 0]} castShadow><boxGeometry args={[2, 7, 3]} />{material}</mesh>)}
        <mesh position={[0, 3, 0]} castShadow><boxGeometry args={[8, 1.3, 3]} />{material}</mesh>
        <mesh position={[0, 0, 1.7]}><boxGeometry args={[5.4, 3.8, 0.35]} />{glow}</mesh>
      </group>
    )
  }
  if (meta.kind === 'workstation') {
    return (
      <group>
        <mesh position={[0, -1.8, 0]} castShadow><boxGeometry args={[11, 1, 6]} />{material}</mesh>
        {[-3, 3].map((x) => (
          <group key={x} position={[x, 1.4, -1]}>
            <mesh castShadow><boxGeometry args={[4.4, 3.2, 0.7]} />{material}</mesh>
            <mesh position={[0, 0, 0.38]}><planeGeometry args={[3.7, 2.5]} />{glow}</mesh>
          </group>
        ))}
      </group>
    )
  }
  if (meta.kind === 'data' || meta.kind === 'pacs') {
    return (
      <group>
        {[-4, 0, 4].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh castShadow><boxGeometry args={[3.2, meta.size[1], 5]} />{material}</mesh>
            {[-2.2, -0.8, 0.6, 2].map((y) => <mesh key={y} position={[0, y, 2.55]}><boxGeometry args={[2.5, 0.45, 0.2]} />{glow}</mesh>)}
          </group>
        ))}
      </group>
    )
  }
  if (meta.kind === 'hl7') {
    return (
      <group>
        <mesh castShadow><cylinderGeometry args={[4.2, 5.4, 8, 28]} />{material}</mesh>
        {[-2.6, 0, 2.6].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[4.7, 0.22, 10, 40]} />{glow}</mesh>)}
      </group>
    )
  }
  if (meta.kind === 'ris') {
    return (
      <group>
        <mesh position={[0, -1.7, 0]} castShadow><cylinderGeometry args={[6, 7, 2.2, 8]} />{material}</mesh>
        {[-4, 0, 4].map((x) => <mesh key={x} position={[x, 1.2, -1]} rotation={[-0.15, 0, 0]}><boxGeometry args={[3.6, 3, 0.5]} />{glow}</mesh>)}
      </group>
    )
  }
  if (meta.kind === 'mri') {
    return (
      <group>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[3.3, 1.65, 18, 40]} />{material}</mesh>
        <mesh position={[0, -2.3, 2]} castShadow><boxGeometry args={[4.4, 0.8, 8]} />{material}</mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.2, 0.22, 12, 40]} />{glow}</mesh>
      </group>
    )
  }
  if (meta.kind === 'runner') {
    return (
      <group>
        <mesh position={[0, -1.7, 0]} castShadow><boxGeometry args={[12, 1.2, 6]} />{material}</mesh>
        {[-4, 0, 4].map((x) => <mesh key={x} position={[x, 1.2, -1]}><boxGeometry args={[3.4, 3, 0.5]} />{glow}</mesh>)}
        <mesh position={[0, 2.5, 2]}><torusGeometry args={[1.6, 0.2, 10, 32]} />{glow}</mesh>
      </group>
    )
  }
  if (meta.kind === 'bms') {
    return (
      <group>
        <mesh position={[0, 1, -1.5]} castShadow><boxGeometry args={[11, 6, 2]} />{material}</mesh>
        {[-3, 3].map((x) => <mesh key={x} position={[x, 1, -0.4]}><torusGeometry args={[1.6, 0.28, 10, 32]} />{glow}</mesh>)}
        <mesh position={[0, -2.3, 2]} castShadow><boxGeometry args={[9, 1.4, 5]} />{material}</mesh>
      </group>
    )
  }
  return (
    <group>
      {[-3.8, 3.8].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[2.7, 2.7, 6.5, 28]} />{material}</mesh>
          <mesh position={[0, 2.8, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.5, 0.2, 10, 32]} />{glow}</mesh>
        </group>
      ))}
    </group>
  )
}

function HospitalNode({
  meta,
  facility,
  selected,
  schematic,
}: {
  meta: NodeMeta
  facility?: HospitalFacility
  selected: boolean
  schematic: boolean
}) {
  const setSelected = usePlantStore((s) => s.setSelectedHospitalFacility)
  const level = statusFor(facility)
  const statusColor = STATUS_COLOR[level]

  return (
    <group
      position={meta.position}
      onClick={(event) => {
        event.stopPropagation()
        setSelected(meta.id)
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default'
      }}
    >
      <MiniModel meta={meta} schematic={schematic} selected={selected} statusColor={statusColor} />

      <mesh position={[0, meta.size[1] / 2 + 0.7, 0]}>
        <sphereGeometry args={[0.42, 14, 14]} />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>

      <pointLight
        position={[0, meta.size[1] / 2 + 2, 0]}
        color={statusColor}
        intensity={selected ? 25 : level === 'alarm' ? 18 : 8}
        distance={18}
      />
      {level === 'alarm' && <AlarmPulse radius={Math.max(meta.size[0], meta.size[2]) * 0.52} />}

      <Html center position={[0, meta.size[1] / 2 + 3.6, 0]} distanceFactor={70} occlude={false}>
        <button
          type="button"
          className={`hospital-node-label ${level}${selected ? ' selected' : ''}`}
          onClick={() => setSelected(meta.id)}
        >
          <span className="hospital-node-dot" />
          <strong>{facility?.label ?? meta.label}</strong>
          <small>{meta.zone}</small>
        </button>
      </Html>
    </group>
  )
}

function Packet({
  points,
  color,
  speed,
  offset,
}: {
  points: THREE.Vector3[]
  color: string
  speed: number
  offset: number
}) {
  const ref = useRef<THREE.Mesh>(null)
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = (clock.elapsedTime * speed + offset) % 1
    ref.current.position.copy(curve.getPointAt(t))
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.55, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
      <pointLight color={color} intensity={5} distance={8} />
    </mesh>
  )
}

function Flow({
  ids,
  color,
  dashed = false,
  active = false,
}: {
  ids: string[]
  color: string
  dashed?: boolean
  active?: boolean
}) {
  const points = ids
    .map((id) => NODE_MAP[id])
    .filter(Boolean)
    .map((node) => new THREE.Vector3(node.position[0], 1.1, node.position[2]))

  return (
    <>
      <Line
        points={points}
        color={active ? '#fb4268' : color}
        lineWidth={active ? 2.6 : dashed ? 1 : 1.6}
        transparent
        opacity={active ? 0.92 : dashed ? 0.42 : 0.68}
        dashed={dashed && !active}
        dashSize={2}
        gapSize={1.3}
      />
      {(!dashed || active) && [0, 0.33, 0.66].map((offset) => (
        <Packet
          key={offset}
          points={points}
          color={active ? '#fb4268' : color}
          speed={active ? 0.16 : 0.07}
          offset={offset}
        />
      ))}
    </>
  )
}

export function HospitalScene({ schematic }: { schematic: boolean }) {
  const snapshot = usePlantStore((s) => s.hospitalSnapshot)
  const selected = usePlantStore((s) => s.selectedHospitalFacility)
  const facilities = useMemo(
    () => Object.fromEntries((snapshot?.facilities ?? []).map((facility) => [facility.id, facility])),
    [snapshot],
  )
  const activeAttacks = snapshot?.active_attacks ?? []

  return (
    <group>
      <ZonePad position={[-32, 0.28, -26]} size={[26, 18]} color={schematic ? '#0b2942' : '#8ca4b5'} />
      <ZonePad position={[-2, 0.28, -22]} size={[39, 22]} color={schematic ? '#0c3440' : '#a5bdbd'} />
      <ZonePad position={[-14, 0.28, 4]} size={[37, 20]} color={schematic ? '#102b4e' : '#9fb0c6'} />
      <ZonePad position={[34, 0.28, -5]} size={[42, 26]} color={schematic ? '#123444' : '#a9c0c8'} />
      <ZonePad position={[16, 0.28, 28]} size={[65, 22]} color={schematic ? '#132942' : '#aab6c6'} />
      <Flow ids={CLINICAL_FLOW} color="#38bdf8" active={activeAttacks.includes('hl7')} />
      <Flow ids={COOLING_FLOW} color="#34d399" active={activeAttacks.includes('cooling')} />
      <Flow ids={ATTACK_FLOW} color="#fbbf24" dashed active={activeAttacks.includes('lateral')} />

      {NODES.map((meta) => (
        <HospitalNode
          key={meta.id}
          meta={meta}
          facility={facilities[meta.id]}
          selected={selected === meta.id}
          schematic={schematic}
        />
      ))}
    </group>
  )
}
