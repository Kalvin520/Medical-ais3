// ============================================================
// 3D 場景 — 醫療設備教學靶機（輸液幫浦病房 / 核磁共振 MRI）
// 離線環境光（Lightformer，無需下載 HDRI）+ 日照陰影 + 後製。
// 各設施場景以本地座標自建；未建模者以通用遙測孿生呈現。
// ============================================================

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  AdaptiveDpr,
  ContactShadows,
  Environment,
  Grid,
  Lightformer,
  OrbitControls,
  Sky,
  useTexture,
} from '@react-three/drei'
import { Bloom, DepthOfField, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'

import { CAMERA } from '../lib/layout'
import { usePlantStore } from '../store/usePlantStore'

import { GenericFacilityScene } from '../facilities/GenericFacilityScene'
import { HospitalScene } from '../facilities/HospitalScene'
import { HospitalFacilityScene } from '../facilities/HospitalFacilityScene'
import { InfusionScene } from '../facilities/InfusionScene'
import { MRIScene } from '../facilities/MRIScene'

// 太陽方向：Sky 可見太陽、方向光與陰影共用同一向量，日照才自然
export const SUN_DIR: Record<'day' | 'night', [number, number, number]> = {
  day: [120, 96, 78],
  night: [42, 10, 30],
}

/** 日照 / 夜間光照配置 */
function Lighting({ day }: { day: boolean }) {
  const sunDir = day ? SUN_DIR.day : ([60, 64, 32] as [number, number, number])
  return (
    <>
      {/* 天空散射光：上方天藍、下方地表反照 */}
      <hemisphereLight
        args={[day ? '#aacbf2' : '#34507a', day ? '#6c7059' : '#0a1422', day ? 0.85 : 0.5]}
      />
      <ambientLight intensity={day ? 0.2 : 0.18} color={day ? '#eef4ff' : '#2a3a5a'} />
      {/* 主太陽：暖白、能量適中避免過曝 */}
      <directionalLight
        position={sunDir}
        intensity={day ? 2.45 : 1.5}
        color={day ? '#fff4e0' : '#9fc3ff'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-110, 110, 110, -110, 0.5, 420]} />
      </directionalLight>
      {/* 天空補光：背陰面帶冷藍散射，避免死黑也避免泛白 */}
      <directionalLight position={[-70, 52, -44]} intensity={day ? 0.45 : 0.6} color={day ? '#bcd2f5' : '#3b6cc4'} />
    </>
  )
}

function SceneEnv({ day }: { day: boolean }) {
  return (
    <Environment resolution={256} frames={1} background={false}>
      {/* 頂部大面積天空光（PBR 反射用） */}
      <Lightformer
        intensity={day ? 1.15 : 0.7}
        color={day ? '#dbe8fb' : '#223a66'}
        form="rect"
        position={[0, 60, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[120, 120, 1]}
      />
      {/* 太陽方向高光（與 SUN_DIR 對齊） */}
      <Lightformer
        intensity={day ? 2.1 : 1.2}
        color={day ? '#fff2d8' : '#bcd4ff'}
        form="circle"
        position={[96, 82, 62]}
        scale={[22, 22, 1]}
      />
      {/* 地平線環境光 */}
      <Lightformer intensity={day ? 0.55 : 0.5} color={day ? '#b9c7d8' : '#16345e'} form="rect" position={[0, 8, -120]} scale={[200, 28, 1]} />
      <Lightformer intensity={day ? 0.55 : 0.5} color={day ? '#b9c7d8' : '#16345e'} form="rect" position={[-120, 8, 0]} rotation={[0, Math.PI / 2, 0]} scale={[200, 28, 1]} />
    </Environment>
  )
}

function Ground({ day }: { day: boolean }) {
  // 統一的院區地面：單一磨損混凝土 PBR
  const ground = useTexture({
    map: '/textures/concrete/diff.jpg',
    normalMap: '/textures/concrete/nor.jpg',
    roughnessMap: '/textures/concrete/rough.jpg',
  })
  useMemo(() => {
    ;(['map', 'normalMap', 'roughnessMap'] as const).forEach((k) => {
      const tex = ground[k]
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(120, 120)
      tex.anisotropy = 8
      if (k === 'map') tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
    })
  }, [ground])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial
          map={ground.map}
          normalMap={ground.normalMap}
          roughnessMap={ground.roughnessMap}
          color={day ? '#b9b6ae' : '#3b424d'}
          metalness={0.04}
        />
      </mesh>
      {/* 技術藍圖網格（淡，作為院區測量格線疊加） */}
      <Grid
        position={[0, 0.04, 0]}
        args={[150, 150]}
        cellSize={2}
        cellThickness={day ? 0.4 : 0.6}
        cellColor={day ? '#9aa1ab' : '#1f3656'}
        sectionSize={10}
        sectionThickness={day ? 0.8 : 1.1}
        sectionColor={day ? '#8ba2c2' : '#2f6bd6'}
        fadeDistance={day ? 150 : 220}
        fadeStrength={day ? 2 : 1.4}
        infiniteGrid
        followCamera={false}
      />
      <ContactShadows position={[0, 0.05, 0]} scale={170} far={60} blur={2.4} opacity={day ? 0.42 : 0.7} color={day ? '#0c1408' : '#000814'} resolution={1024} />
    </group>
  )
}

export default function Scene() {
  const day = usePlantStore((s) => s.dayMode)
  const schematic = usePlantStore((s) => s.sceneMode) === 'schematic'
  const active = usePlantStore((s) => s.activeFacility)
  const appView = usePlantStore((s) => s.appView)

  const fog = useMemo(() => {
    if (schematic) return new THREE.FogExp2('#03060d', 0.006)
    return day ? new THREE.FogExp2('#c4d3e3', 0.0016) : new THREE.FogExp2('#070c16', 0.0042)
  }, [day, schematic])

  return (
    <Canvas
      className="scene-canvas"
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: schematic ? 1.1 : day ? 0.98 : 1.15,
      }}
      camera={{ position: CAMERA.position, fov: CAMERA.fov, near: 0.5, far: 2200 }}
    >
      <color attach="background" args={[schematic ? '#03060d' : day ? '#bcd2ea' : '#060b14']} />
      <primitive object={fog} attach="fog" />

      {/* 乾淨程序化天空（日/夜）；環境光僅用於 PBR 反射，不當背景 */}
      {!schematic && (
        <Sky
          distance={4500}
          sunPosition={day ? SUN_DIR.day : [40, 4, 30]}
          turbidity={day ? 7 : 12}
          rayleigh={day ? 2.4 : 0.6}
          mieCoefficient={day ? 0.005 : 0.006}
          mieDirectionalG={day ? 0.8 : 0.9}
        />
      )}

      {schematic ? <ambientLight intensity={0.6} color="#9fd6ff" /> : <Lighting day={day} />}

      <Suspense fallback={null}>
        {!schematic && <SceneEnv day={day} />}
        <Ground day={day} />
        {appView === 'hospital' ? (
          <HospitalScene schematic={schematic} />
        ) : appView === 'hospital-facility' ? (
          <HospitalFacilityScene schematic={schematic} />
        ) : active === 'infusion' ? (
          <InfusionScene schematic={schematic} />
        ) : active === 'mri' ? (
          <MRIScene schematic={schematic} />
        ) : (
          <GenericFacilityScene schematic={schematic} />
        )}
      </Suspense>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={CAMERA.minDistance}
        maxDistance={CAMERA.maxDistance}
        maxPolarAngle={Math.PI / 2.15}
        target={CAMERA.target}
      />

      {/* 單一 composer + 條件式 effect 陣列 */}
      <EffectComposer multisampling={0} enableNormalPass>
        {
          [
            !schematic && (
              <N8AO key="ao" aoRadius={6} intensity={day ? 2 : 3} distanceFalloff={1} quality="medium" color={day ? '#1a2230' : '#04070d'} />
            ),
            <Bloom
              key="bloom"
              mipmapBlur
              luminanceThreshold={schematic ? 0.45 : day ? 1.15 : 0.7}
              luminanceSmoothing={schematic ? 0.3 : 0.25}
              intensity={schematic ? 1.1 : day ? 0.32 : 1.05}
            />,
            !schematic && (
              <DepthOfField key="dof" focusDistance={0.012} focalLength={0.05} bokehScale={day ? 1.6 : 2.2} height={480} />
            ),
            <Vignette key="vig" eskil={false} offset={schematic ? 0.22 : 0.3} darkness={schematic ? 0.9 : day ? 0.4 : 0.85} />,
            <SMAA key="smaa" />,
          ].filter(Boolean) as JSX.Element[]
        }
      </EffectComposer>

      <AdaptiveDpr pixelated />
    </Canvas>
  )
}
