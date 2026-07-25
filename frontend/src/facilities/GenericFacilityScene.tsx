// ============================================================
// 通用設施場景 — 尚無專屬 3D 模型的設施暫以
// 「即時遙測孿生塔」呈現：每個通道一根高度=量程占比、顏色=狀態的光柱，
// 浮動標籤顯示數值。寫實=實心金屬光柱，示意=半透明全像光柱。
// 後續會以專屬 3D 場景取代。
// ============================================================

import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { usePlantStore } from '../store/usePlantStore'
import { getFacilityProfile } from './profiles'
import { channelState, fillPercent } from '../lib/channels'

const OK = '#34d399'
const WARN = '#fbbf24'
const DANGER = '#fb4268'

export function GenericFacilityScene({ schematic }: { schematic: boolean }) {
  const active = usePlantStore((s) => s.activeFacility)
  const st = usePlantStore((s) => s.statuses[s.activeFacility])
  const prof = getFacilityProfile(active)
  const channels = useMemo(() => [...prof.core, ...prof.derived], [prof])

  const cols = 4
  const gapX = 12
  const gapZ = 12
  const rows = Math.ceil(channels.length / cols)
  const radius = Math.max(34, cols * gapX * 0.62)

  return (
    <group>
      {/* 平台 + 外環光 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[radius, 72]} />
        <meshStandardMaterial color={schematic ? '#081427' : '#1a2733'} metalness={0.35} roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[radius - 0.7, radius, 72]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} toneMapped={false} />
      </mesh>

      {channels.map((c, i) => {
        const v = (st?.[c.key as string] as number) ?? 0
        const f = fillPercent(c, v)
        const state = channelState(c, v)
        const color = state === 'danger' ? DANGER : state === 'warning' ? WARN : OK
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = (col - (cols - 1) / 2) * gapX
        const z = (row - (rows - 1) / 2) * gapZ
        const h = 1.5 + (f / 100) * 18

        return (
          <group key={c.key as string} position={[x, 0, z]}>
            <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[5, 0.6, 5]} />
              <meshStandardMaterial color="#26333f" metalness={0.5} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.6 + h / 2, 0]} castShadow>
              <boxGeometry args={[3.4, h, 3.4]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={schematic ? 0.9 : 0.45}
                transparent
                opacity={schematic ? 0.5 : 0.92}
                metalness={0.2}
                roughness={0.35}
                toneMapped={false}
              />
            </mesh>
            <Html position={[0, h + 4, 0]} center distanceFactor={64} style={{ pointerEvents: 'none' }}>
              <div className="twin-node">
                <span className="tn-label">{c.label}</span>
                <span className="tn-val" style={{ color }}>
                  {v.toFixed(c.decimals)}
                  <i>{c.unit}</i>
                </span>
              </div>
            </Html>
          </group>
        )
      })}

      <Html position={[0, 30, -gapZ]} center distanceFactor={90} style={{ pointerEvents: 'none' }}>
        <div className="twin-title">{prof.name} · 即時遙測孿生</div>
      </Html>
    </group>
  )
}
