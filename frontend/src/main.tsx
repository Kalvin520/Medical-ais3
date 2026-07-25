import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// ── 🐉 奶龍彩蛋（開發者控制台）——跨域3：姚佳凱、陳欣霈、林致佑、陳詠智 ──
// 純文字、不含任何版權角色圖；僅在瀏覽器 console 顯示。
/* eslint-disable no-console */
console.log(
  '%c🐉 奶龍 says: 歡迎來到醫療設備教學靶機！\n' +
    '   本靶機僅供 AIS3 隔離教學環境的授權模糊測試與 IEC 62443 合規演練。\n' +
    '   協定：Modbus/TCP · HL7/MLLP · DICOM。祝 fuzzing 順利，記得負責任揭露！\n' +
    '   —— 送給 跨域3：姚佳凱 · 陳欣霈 · 林致佑 · 陳詠智',
  'color:#34d399;font-family:monospace;font-size:12px;line-height:1.6',
)
console.log(
  '%c   ▄▄▄▄\n  █ ^ ^█   < 奶龍\n  █  ▽ █\n   ▀▀▀▀',
  'color:#7fd6ff;font-family:monospace;font-size:12px;line-height:1.2',
)
/* eslint-enable no-console */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
