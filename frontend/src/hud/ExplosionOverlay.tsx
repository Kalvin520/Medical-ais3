// ============================================================
// 全螢幕爆炸覆蓋層 — 讀取 store 的 boom，閃光 + 中央訊息
// boom 由 spawnExplosion 設定，2.6s 後自動清除。
// 以 boom.id 當 key，讓既有 CSS 動畫每次爆炸重新觸發。
// ============================================================

import { usePlantStore } from '../store/usePlantStore'

export function ExplosionOverlay() {
  const boom = usePlantStore((s) => s.boom)

  return (
    <>
      <div
        key={boom?.id ?? 'idle'}
        className={'boom-overlay' + (boom ? ' active' : '')}
      />
      {boom && (
        <div key={boom.id} className="boom-message active">
          {boom.message}
        </div>
      )}
    </>
  )
}
