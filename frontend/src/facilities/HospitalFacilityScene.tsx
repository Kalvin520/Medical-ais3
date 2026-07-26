import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { usePlantStore } from '../store/usePlantStore'
import type { HospitalLevel } from '../types/telemetry'

const OK = '#34d399'
const DANGER = '#fb4268'
const CYAN = '#38bdf8'
const AMBER = '#fbbf24'

const TITLES: Record<string, [string, string]> = {
  'vendor-entry': ['廠商安全入口', 'VENDOR ACCESS GATEWAY'],
  'biomed-ws': ['醫療工程工作站', 'BIOMED ENGINEERING STATION'],
  'ehr-fhir': ['EHR / FHIR 資料中心', 'CLINICAL DATA CORE'],
  'hl7-engine': ['HL7 整合引擎', 'MESSAGE INTEGRATION HUB'],
  'ris-mwl': ['RIS / MWL 排程中心', 'RADIOLOGY WORKLIST CONTROL'],
  pacs: ['PACS 影像儲存中心', 'DICOM ARCHIVE ARRAY'],
  'protocol-runner': ['協議工具箱', 'AUTHORIZED PROTOCOL OPERATIONS'],
  bms: ['BMS 設施監控中心', 'BUILDING MANAGEMENT SYSTEM'],
  'chiller-sim': ['MRI 冷卻機房', 'BACNET CHILLER PLANT'],
}

function M({
  schematic,
  color,
  emissive,
  metalness = 0.58,
  roughness = 0.42,
  opacity = 1,
}: {
  schematic: boolean
  color: string
  emissive?: string
  metalness?: number
  roughness?: number
  opacity?: number
}) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={emissive ?? (schematic ? color : '#000000')}
      emissiveIntensity={emissive ? 1.5 : schematic ? 0.55 : 0}
      metalness={schematic ? 0.12 : metalness}
      roughness={schematic ? 0.5 : roughness}
      transparent={schematic || opacity < 1}
      opacity={schematic ? Math.min(opacity, 0.42) : opacity}
      toneMapped={!emissive}
    />
  )
}

function Platform({ schematic, accent = CYAN }: { schematic: boolean; accent?: string }) {
  return (
    <group>
      <mesh position={[0, 0.22, 0]} receiveShadow>
        <cylinderGeometry args={[31, 33, 0.44, 72]} />
        <M schematic={schematic} color={schematic ? '#07182b' : '#263441'} metalness={0.28} roughness={0.72} />
      </mesh>
      {[24, 30.5].map((radius) => (
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.48, 0]}>
          <ringGeometry args={[radius, radius + 0.18, 96]} />
          <meshBasicMaterial color={accent} transparent opacity={radius > 28 ? 0.5 : 0.22} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function SceneTitle({ id, level }: { id: string; level: HospitalLevel }) {
  const [title, sub] = TITLES[id] ?? [id, 'VIRTUAL HOSPITAL DEVICE']
  return (
    <Html position={[0, 24, -15]} center distanceFactor={82} style={{ pointerEvents: 'none' }}>
      <div className={`facility-scene-title ${level}`}>
        <span>{sub}</span>
        <strong>{title}</strong>
        <em>{level === 'ok' ? 'ONLINE · NORMAL' : level === 'alarm' ? 'ALERT · DEGRADED' : 'OFFLINE'}</em>
      </div>
    </Html>
  )
}

function StatusBeacon({ position, level }: { position: [number, number, number]; level: HospitalLevel }) {
  const color = level === 'alarm' ? DANGER : level === 'ok' ? OK : '#51607a'
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const pulse = level === 'alarm' ? 0.85 + Math.sin(clock.elapsedTime * 7) * 0.15 : 1
    ref.current.scale.setScalar(pulse)
  })
  return (
    <group position={position}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.48, 18, 18]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} toneMapped={false} />
      </mesh>
      <pointLight color={color} intensity={level === 'alarm' ? 35 : 16} distance={14} />
    </group>
  )
}

function Screen({
  position,
  rotation = [0, 0, 0],
  size = [6, 3.5],
  color = CYAN,
  schematic,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  size?: [number, number]
  color?: string
  schematic: boolean
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[size[0] + 0.55, size[1] + 0.55, 0.45]} />
        <M schematic={schematic} color="#152332" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.25]}>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.45} toneMapped={false} />
      </mesh>
      {[-0.25, 0.15, 0.5].map((y, index) => (
        <mesh key={y} position={[0, y * size[1], 0.28]}>
          <planeGeometry args={[size[0] * (0.72 - index * 0.1), 0.05]} />
          <meshBasicMaterial color="#d7f4ff" transparent opacity={0.72} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function Rack({ x, z, schematic, level = 'ok' }: { x: number; z: number; schematic: boolean; level?: HospitalLevel }) {
  const light = level === 'alarm' ? DANGER : OK
  return (
    <group position={[x, 5.2, z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.5, 10.4, 4.2]} />
        <M schematic={schematic} color="#202d39" metalness={0.78} roughness={0.32} />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => (
        <group key={index} position={[0, 3.75 - index * 1.05, 2.13]}>
          <mesh>
            <boxGeometry args={[3.7, 0.7, 0.18]} />
            <M schematic={schematic} color="#0b1119" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[1.35, 0, 0.13]}>
            <sphereGeometry args={[0.09, 8, 8]} />
            <meshBasicMaterial color={index % 3 === 0 ? AMBER : light} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Rotor({ position, radius = 3, color = CYAN }: { position: [number, number, number]; radius?: number; color?: string }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * 1.8
  })
  return (
    <group ref={ref} position={position}>
      <mesh>
        <torusGeometry args={[radius, 0.18, 12, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      {[0, Math.PI / 2].map((angle) => (
        <mesh key={angle} rotation={[0, 0, angle]}>
          <boxGeometry args={[radius * 1.7, 0.22, 0.18]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function VendorScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  return (
    <group>
      <Platform schematic={schematic} accent={AMBER} />
      <mesh position={[0, 7.2, -6]} castShadow>
        <boxGeometry args={[21, 14, 3.2]} />
        <M schematic={schematic} color="#233140" metalness={0.72} roughness={0.36} />
      </mesh>
      <mesh position={[0, 6.2, -4.25]}>
        <boxGeometry args={[7.5, 10.2, 0.4]} />
        <M schematic={schematic} color="#07121d" emissive={level === 'alarm' ? DANGER : CYAN} />
      </mesh>
      {[-8.5, 8.5].map((x) => (
        <group key={x} position={[x, 4.3, 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[1.2, 1.5, 8.6, 18]} />
            <M schematic={schematic} color="#5f6f7d" metalness={0.85} roughness={0.28} />
          </mesh>
          <StatusBeacon position={[0, 5, 0]} level={level} />
        </group>
      ))}
      <mesh position={[0, 3.3, 5]} rotation={[0, 0, -0.16]} castShadow>
        <boxGeometry args={[18, 0.65, 0.65]} />
        <M schematic={schematic} color="#f4efe4" emissive={level === 'alarm' ? DANGER : undefined} />
      </mesh>
      <Screen position={[-11, 5.5, -1]} rotation={[0, 0.35, 0]} size={[4.8, 3]} color={AMBER} schematic={schematic} />
      <Rotor position={[0, 6.2, -3.95]} radius={2.3} color={level === 'alarm' ? DANGER : CYAN} />
    </group>
  )
}

function BiomedScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  return (
    <group>
      <Platform schematic={schematic} />
      <mesh position={[0, 3.8, 1]} castShadow receiveShadow>
        <boxGeometry args={[22, 1, 9]} />
        <M schematic={schematic} color="#596875" metalness={0.35} roughness={0.62} />
      </mesh>
      {[-7, 0, 7].map((x, index) => (
        <Screen key={x} position={[x, 9, -2.4]} rotation={[-0.08, 0, 0]} size={[5.4, 3.4]} color={index === 1 && level === 'alarm' ? DANGER : CYAN} schematic={schematic} />
      ))}
      <mesh position={[10, 5.8, 1]} castShadow>
        <boxGeometry args={[3.8, 7, 5]} />
        <M schematic={schematic} color="#182430" metalness={0.82} roughness={0.28} />
      </mesh>
      {Array.from({ length: 5 }, (_, index) => (
        <mesh key={index} position={[10, 7.8 - index * 1.1, 3.53]}>
          <boxGeometry args={[2.7, 0.55, 0.12]} />
          <M schematic={schematic} color="#050a10" emissive={index === 0 ? OK : CYAN} />
        </mesh>
      ))}
      <mesh position={[-9, 2.2, 5]} castShadow>
        <cylinderGeometry args={[2.1, 2.4, 4.2, 24]} />
        <M schematic={schematic} color="#2d3b47" metalness={0.65} roughness={0.4} />
      </mesh>
      <Rotor position={[-9, 5, 5]} radius={1.4} color={level === 'alarm' ? DANGER : OK} />
      <StatusBeacon position={[11, 10, 1]} level={level} />
    </group>
  )
}

function FhirScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  const orb = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (orb.current) {
      orb.current.rotation.y += dt * 0.45
      orb.current.rotation.x += dt * 0.18
    }
  })
  return (
    <group>
      <Platform schematic={schematic} accent={OK} />
      {[-12, 12].map((x) => <Rack key={x} x={x} z={2} schematic={schematic} level={level} />)}
      <group ref={orb} position={[0, 9, 0]}>
        {[0, Math.PI / 2, Math.PI / 4].map((angle) => (
          <mesh key={angle} rotation={[angle, angle * 0.5, 0]}>
            <torusGeometry args={[5.2, 0.18, 12, 64]} />
            <meshStandardMaterial color={level === 'alarm' ? DANGER : OK} emissive={level === 'alarm' ? DANGER : OK} emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        ))}
        <mesh>
          <sphereGeometry args={[2.2, 28, 28]} />
          <meshStandardMaterial color="#87f5d1" emissive={OK} emissiveIntensity={1.1} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>
      {[-5, 0, 5].map((x) => (
        <Screen key={x} position={[x, 4.3, 9]} rotation={[-0.2, 0, 0]} size={[4.2, 2.4]} color={OK} schematic={schematic} />
      ))}
      <StatusBeacon position={[0, 17, 0]} level={level} />
    </group>
  )
}

function Hl7Scene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  const coreColor = level === 'alarm' ? DANGER : CYAN
  return (
    <group>
      <Platform schematic={schematic} accent={coreColor} />
      <mesh position={[0, 7, 0]} castShadow>
        <cylinderGeometry args={[5.5, 7.5, 13, 32]} />
        <M schematic={schematic} color="#243746" metalness={0.74} roughness={0.28} />
      </mesh>
      {[-3.5, 0, 3.5].map((y, index) => (
        <mesh key={y} position={[0, 7 + y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[6.4 + index * 0.25, 0.22, 12, 64]} />
          <meshStandardMaterial color={coreColor} emissive={coreColor} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2
        const x = Math.sin(angle) * 17
        const z = Math.cos(angle) * 17
        return (
          <group key={index}>
            <Line points={[[Math.sin(angle) * 6, 6, Math.cos(angle) * 6], [x, 2, z]]} color={index % 2 ? AMBER : CYAN} lineWidth={2} transparent opacity={0.72} />
            <Screen position={[x, 4, z]} rotation={[0, angle, 0]} size={[4.2, 2.6]} color={index % 2 ? AMBER : coreColor} schematic={schematic} />
          </group>
        )
      })}
      <Rotor position={[0, 14.5, 0]} radius={3.2} color={coreColor} />
      <StatusBeacon position={[0, 18, 0]} level={level} />
    </group>
  )
}

function RisScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  return (
    <group>
      <Platform schematic={schematic} accent="#a78bfa" />
      <mesh position={[0, 3, 1]} castShadow>
        <cylinderGeometry args={[12, 14, 1.7, 8]} />
        <M schematic={schematic} color="#344451" metalness={0.48} roughness={0.55} />
      </mesh>
      {[-9, -3, 3, 9].map((x, index) => (
        <Screen key={x} position={[x, 8, -2.5]} rotation={[-0.1, 0, 0]} size={[5, 3.4]} color={index === 1 && level === 'alarm' ? DANGER : '#a78bfa'} schematic={schematic} />
      ))}
      {[-10, -5, 0, 5, 10].map((x, index) => (
        <group key={x} position={[x, 1.3, 9]}>
          <mesh castShadow>
            <boxGeometry args={[3.4, 1.2, 5]} />
            <M schematic={schematic} color="#dce6ee" metalness={0.18} roughness={0.72} />
          </mesh>
          <mesh position={[0, 0.67, 0]}>
            <boxGeometry args={[2.8, 0.12, 4.3]} />
            <M schematic={schematic} color={index < 3 ? '#7dd3fc' : '#c4b5fd'} emissive={index === 2 && level === 'alarm' ? DANGER : undefined} />
          </mesh>
        </group>
      ))}
      <StatusBeacon position={[13, 7, -4]} level={level} />
    </group>
  )
}

function PacsScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  const archiveColor = level === 'alarm' ? DANGER : '#60a5fa'
  return (
    <group>
      <Platform schematic={schematic} accent="#60a5fa" />
      {[-14, -7, 7, 14].map((x) => <Rack key={x} x={x} z={2} schematic={schematic} level={level} />)}
      <group position={[0, 7, -8]}>
        <mesh castShadow>
          <cylinderGeometry args={[5.3, 5.3, 13, 40]} />
          <M schematic={schematic} color="#26394a" metalness={0.8} roughness={0.28} />
        </mesh>
        {[-4, -1.3, 1.3, 4].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <torusGeometry args={[5.45, 0.16, 10, 48]} />
            <meshBasicMaterial color={archiveColor} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Screen position={[0, 9, 9]} size={[8, 5]} color={archiveColor} schematic={schematic} />
      <StatusBeacon position={[0, 15, -8]} level={level} />
    </group>
  )
}

function RunnerScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  return (
    <group>
      <Platform schematic={schematic} accent={OK} />
      <mesh position={[0, 3.2, 1]} castShadow>
        <boxGeometry args={[23, 1.2, 9]} />
        <M schematic={schematic} color="#374753" metalness={0.45} roughness={0.58} />
      </mesh>
      {[-7, 0, 7].map((x, index) => (
        <Screen key={x} position={[x, 8.5, -2.4]} size={[5.5, 3.6]} color={index === 0 ? '#22c55e' : index === 1 ? CYAN : AMBER} schematic={schematic} />
      ))}
      {[
        [-10, 'HL7'],
        [0, 'DICOM'],
        [10, 'BACnet'],
      ].map(([x, label]) => (
        <group key={String(label)} position={[Number(x), 2.1, 10]}>
          <mesh castShadow>
            <cylinderGeometry args={[2.1, 2.5, 4.2, 24]} />
            <M schematic={schematic} color="#263541" metalness={0.72} roughness={0.34} />
          </mesh>
          <Rotor position={[0, 2.6, 0]} radius={1.2} color={label === 'HL7' ? OK : label === 'DICOM' ? CYAN : AMBER} />
          <Html position={[0, 4.8, 0]} center distanceFactor={70} style={{ pointerEvents: 'none' }}>
            <div className="facility-tool-label">{label}</div>
          </Html>
        </group>
      ))}
      <mesh position={[13, 8, 1]} castShadow>
        <cylinderGeometry args={[0.22, 0.4, 13, 12]} />
        <M schematic={schematic} color="#8ba0b1" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[13, 14.5, 1]}>
        <sphereGeometry args={[0.7, 18, 18]} />
        <meshStandardMaterial color={OK} emissive={OK} emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      <StatusBeacon position={[-13, 10, 0]} level={level} />
    </group>
  )
}

function BmsScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  const color = level === 'alarm' ? DANGER : OK
  return (
    <group>
      <Platform schematic={schematic} accent={OK} />
      <mesh position={[0, 7, -7]} castShadow>
        <boxGeometry args={[24, 14, 3]} />
        <M schematic={schematic} color="#2b3a44" metalness={0.7} roughness={0.38} />
      </mesh>
      {[-7, 0, 7].map((x) => (
        <Screen key={x} position={[x, 8, -5.35]} size={[5.2, 3.6]} color={color} schematic={schematic} />
      ))}
      {[-10, 0, 10].map((x) => (
        <group key={x} position={[x, 3.2, 5]}>
          <mesh castShadow>
            <boxGeometry args={[6.5, 5.5, 5.5]} />
            <M schematic={schematic} color="#687985" metalness={0.6} roughness={0.42} />
          </mesh>
          <Rotor position={[0, 0, 2.8]} radius={1.8} color={color} />
        </group>
      ))}
      <Line points={[[-17, 1, 10], [-17, 1, -1], [17, 1, -1], [17, 1, 10]]} color={color} lineWidth={4} />
      <StatusBeacon position={[0, 16, -7]} level={level} />
    </group>
  )
}

function ChillerScene({ schematic, level }: { schematic: boolean; level: HospitalLevel }) {
  const color = level === 'alarm' ? DANGER : '#22d3ee'
  return (
    <group>
      <Platform schematic={schematic} accent="#22d3ee" />
      {[-10, 10].map((x) => (
        <group key={x} position={[x, 6, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[5, 5, 13, 36]} />
            <M schematic={schematic} color="#8ca9b4" metalness={0.72} roughness={0.34} />
          </mesh>
          {[-5.5, 5.5].map((y) => (
            <mesh key={y} position={[y, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[5.1, 0.25, 12, 48]} />
              <M schematic={schematic} color="#365364" emissive={level === 'alarm' ? DANGER : undefined} />
            </mesh>
          ))}
          <Rotor position={[0, 5.1, 0]} radius={2.3} color={color} />
        </group>
      ))}
      {[-15, 0, 15].map((x) => (
        <group key={x} position={[x, 2.3, 11]}>
          <mesh castShadow>
            <cylinderGeometry args={[2.3, 2.7, 4.6, 24]} />
            <M schematic={schematic} color="#365264" metalness={0.76} roughness={0.3} />
          </mesh>
          <StatusBeacon position={[0, 3, 0]} level={level} />
        </group>
      ))}
      <Line points={[[-16, 6, 6], [-16, 6, 11], [16, 6, 11], [16, 6, 6]]} color={color} lineWidth={5} />
      <Line points={[[-10, 1, -7], [10, 1, -7]]} color={AMBER} lineWidth={4} />
    </group>
  )
}

export function HospitalFacilityScene({ schematic }: { schematic: boolean }) {
  const selectedId = usePlantStore((state) => state.selectedHospitalFacility) ?? 'vendor-entry'
  const snapshot = usePlantStore((state) => state.hospitalSnapshot)
  const facility = useMemo(
    () => snapshot?.facilities.find((item) => item.id === selectedId),
    [selectedId, snapshot],
  )
  const level = facility?.level ?? 'offline'

  let model
  switch (selectedId) {
    case 'vendor-entry': model = <VendorScene schematic={schematic} level={level} />; break
    case 'biomed-ws': model = <BiomedScene schematic={schematic} level={level} />; break
    case 'ehr-fhir': model = <FhirScene schematic={schematic} level={level} />; break
    case 'hl7-engine': model = <Hl7Scene schematic={schematic} level={level} />; break
    case 'ris-mwl': model = <RisScene schematic={schematic} level={level} />; break
    case 'pacs': model = <PacsScene schematic={schematic} level={level} />; break
    case 'protocol-runner': model = <RunnerScene schematic={schematic} level={level} />; break
    case 'bms': model = <BmsScene schematic={schematic} level={level} />; break
    case 'chiller-sim': model = <ChillerScene schematic={schematic} level={level} />; break
    default: model = <VendorScene schematic={schematic} level={level} />
  }

  return (
    <group position={[-4, 0, -8]}>
      {model}
      <SceneTitle id={selectedId} level={level} />
    </group>
  )
}
