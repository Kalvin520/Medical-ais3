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
  kind?: 'mri' | 'chiller' | 'gateway'
}

const NODES: NodeMeta[] = [
  { id: 'vendor-entry', label: '廠商入口', zone: 'DMZ', position: [-43, 2.8, -27], size: [12, 5.6, 10], kind: 'gateway' },
  { id: 'biomed-ws', label: '醫工工作站', zone: '臨床區', position: [-21, 3.5, -20], size: [12, 7, 10] },
  { id: 'ehr-fhir', label: 'EHR / FHIR', zone: '臨床區', position: [0, 4, -26], size: [13, 8, 10] },
  { id: 'hl7-engine', label: 'HL7 Engine', zone: '整合區', position: [-24, 4, 2], size: [13, 8, 10] },
  { id: 'ris-mwl', label: 'RIS / MWL', zone: '整合區', position: [-4, 4, 4], size: [13, 8, 10] },
  { id: 'mri-sim', label: 'MRI Simulator', zone: '影像區', position: [23, 4.5, -4], size: [16, 9, 13], kind: 'mri' },
  { id: 'pacs', label: 'PACS / Orthanc', zone: '影像區', position: [47, 5, -10], size: [14, 10, 11] },
  { id: 'protocol-runner', label: 'Protocol Runner', zone: 'OT 區', position: [-10, 4, 29], size: [14, 8, 10] },
  { id: 'bms', label: 'BMS', zone: 'OT 區', position: [15, 4, 27], size: [12, 8, 10] },
  { id: 'chiller-sim', label: 'Chiller / BACnet', zone: 'OT 區', position: [39, 3.5, 27], size: [15, 7, 11], kind: 'chiller' },
  { id: 'reset-controller', label: 'Reset Controller', zone: '管理區', position: [-39, 3.5, 27], size: [13, 7, 10] },
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
  const bodyColor = schematic ? '#0b2740' : '#d8e2ea'

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
      <mesh castShadow receiveShadow>
        <boxGeometry args={meta.size} />
        <meshStandardMaterial
          color={selected ? '#b9efff' : bodyColor}
          emissive={statusColor}
          emissiveIntensity={schematic ? 0.25 : selected ? 0.16 : 0.04}
          roughness={0.45}
          metalness={0.18}
        />
      </mesh>

      <mesh position={[0, meta.size[1] / 2 + 0.25, 0]}>
        <boxGeometry args={[meta.size[0] * 0.84, 0.45, meta.size[2] * 0.84]} />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.8} />
      </mesh>

      {meta.kind === 'mri' && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.4, meta.size[2] / 2 + 0.6]} castShadow>
          <torusGeometry args={[2.5, 1.15, 16, 36]} />
          <meshStandardMaterial color="#edf8ff" emissive="#38bdf8" emissiveIntensity={0.18} />
        </mesh>
      )}
      {meta.kind === 'chiller' && (
        <>
          {[-3.5, 0, 3.5].map((x) => (
            <mesh key={x} position={[x, meta.size[1] / 2 + 1, 0]} castShadow>
              <cylinderGeometry args={[1.15, 1.15, 1.8, 20]} />
              <meshStandardMaterial color="#9ecbd2" metalness={0.4} roughness={0.35} />
            </mesh>
          ))}
        </>
      )}
      {meta.kind === 'gateway' && (
        <mesh position={[0, 0, meta.size[2] / 2 + 0.7]}>
          <boxGeometry args={[meta.size[0] * 0.48, meta.size[1] * 0.58, 1.4]} />
          <meshStandardMaterial color="#172638" emissive="#38bdf8" emissiveIntensity={0.22} />
        </mesh>
      )}

      <pointLight
        position={[0, meta.size[1] / 2 + 2, 0]}
        color={statusColor}
        intensity={selected ? 25 : level === 'alarm' ? 18 : 8}
        distance={18}
      />

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

function Flow({ ids, color, dashed = false }: { ids: string[]; color: string; dashed?: boolean }) {
  const points = ids
    .map((id) => NODE_MAP[id])
    .filter(Boolean)
    .map((node) => new THREE.Vector3(node.position[0], 1.1, node.position[2]))

  return (
    <>
      <Line
        points={points}
        color={color}
        lineWidth={dashed ? 1 : 1.6}
        transparent
        opacity={dashed ? 0.42 : 0.68}
        dashed={dashed}
        dashSize={2}
        gapSize={1.3}
      />
      {!dashed && [0, 0.33, 0.66].map((offset) => (
        <Packet key={offset} points={points} color={color} speed={0.07} offset={offset} />
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

  return (
    <group>
      <ZonePad position={[-32, 0.28, -26]} size={[26, 18]} color={schematic ? '#0b2942' : '#8ca4b5'} />
      <ZonePad position={[-2, 0.28, -22]} size={[39, 22]} color={schematic ? '#0c3440' : '#a5bdbd'} />
      <ZonePad position={[-14, 0.28, 4]} size={[37, 20]} color={schematic ? '#102b4e' : '#9fb0c6'} />
      <ZonePad position={[34, 0.28, -5]} size={[42, 26]} color={schematic ? '#123444' : '#a9c0c8'} />
      <ZonePad position={[16, 0.28, 28]} size={[65, 22]} color={schematic ? '#132942' : '#aab6c6'} />
      <ZonePad position={[-39, 0.28, 27]} size={[22, 18]} color={schematic ? '#23304b' : '#b0b5c2'} />

      <Flow ids={CLINICAL_FLOW} color="#38bdf8" />
      <Flow ids={COOLING_FLOW} color="#34d399" />
      <Flow ids={ATTACK_FLOW} color="#fbbf24" dashed />

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
