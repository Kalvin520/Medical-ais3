# 醫療設備教學靶機 · Medical Device Cyber Range (AIS3)

一套供 **AIS3 專題**使用的**模擬醫療設備靶機**，用於在隔離環境中練習「自動化模糊測試（fuzzing）」與 IEC 62443 工控資安合規演練。
後端以 Go 撰寫，把兩台醫療設備模擬成獨立 PLC，並同時開放 **Modbus/TCP**、**HL7/MLLP**、**DICOM** 三種通訊協定端點作為 fuzz 標的；
前端以 React + React-Three-Fiber 呈現擬真 3D 數位孿生與即時遙測，讓攻擊後果「看得見」。

> 這個分支（`teaching/ais3-medical-target`）是**交給學員的精簡版**，只保留醫療靶機與通用框架。
> 交付前務必先讀 [`docs/04-交付與安全須知.md`](docs/04-交付與安全須知.md)（含 git 歷史與匯出注意事項）。

給跨域3：姚佳凱 · 陳欣霈 · 林致佑 · 陳詠智 🐉

---

## ⚠️ 使用限制（先讀這段）

- **僅供隔離教學環境**：請在無外網、與臨床網路完全隔離的實驗網段執行。這是「模擬」設備，不是、也不可對接任何真實醫療儀器。
- **僅授權範圍內測試**：對本靶機做任何攻擊/fuzz 皆屬授權；但請勿把這些手法用於未授權的真實系統。
- **負責任揭露**：若在真實醫材研究中發現漏洞，走 TWCERT/CC、廠商 PSIRT 或 FDA/衛福部通報流程，勿公開 PoC。
- 靶機故意「寬鬆」（少驗證、易崩潰邊界），目的是當 fuzz 標的；請勿把它的健壯性當成真實產品參考。

---

## 🏥 靶機內容

| Unit | 設施 id | 名稱 | 說明 | 典型危害情境 |
|------|---------|------|------|--------------|
| 1 | `infusion` | 輸液幫浦病房 | IV 幫浦：流速/濃度/阻塞閾值 | 藥物過量、管路阻塞、空氣栓塞 |
| 2 | `mri` | 核磁共振 MRI | 周邊安全 PLC：冷卻/液氦/射頻/門禁 | 磁體失超(quench)、SAR 灼傷、門禁互鎖失效 |

三種可 fuzz 的協定端點：
- **Modbus/TCP** — 設備控制/遙測（Holding Register + Coil），依 Unit ID 路由。
- **HL7/MLLP** — 醫療訊息（ADT/ORM 風格），MLLP 框架 `0x0B … 0x1C 0x0D`。
- **DICOM** — 最小上層協定（A-ASSOCIATE / C-ECHO / A-RELEASE）。

詳細暫存器映射、埠號與 fuzz 進入點見 [`docs/02-協定說明.md`](docs/02-協定說明.md)。

---

## 🚀 快速開始

需求：Go 1.22+、Node.js 18+、npm。

```bash
# 1) 前端打包（產出 backend 會直接 serve 的 dist/）
cd frontend && npm install && npm run build && cd ..

# 2) 啟動後端（同源 serve 前端 + 三種協定端點）
cd backend && go run .
```

預設埠：

| 服務 | 位址 | 覆寫方式 |
|------|------|----------|
| HTTP / WebSocket / 前端 | `:8090` | `-http-port` / `HTTP_PORT` |
| Modbus TCP | 自動 `502`→`1502` | `-modbus-port` / `MODBUS_PORT` |
| HL7 MLLP | `:2575` | `-hl7-port` / `HL7_PORT` |
| DICOM | `:11112` | `-dicom-port` / `DICOM_PORT` |

開瀏覽器 → `http://localhost:8090/` → 用右上角切換設施（輸液幫浦病房 / 核磁共振 MRI）、切「寫實 / 示意」、日 / 夜。
右側「攻擊模擬」可一鍵注入異常參數觀察 3D 後果；也可用 Modbus 客戶端自行寫入。

開發模式（前端熱更新，需另開後端）：`cd frontend && npm run dev`（:3000，proxy `/ws` `/api` 到 :8090）。

---

## 🎯 你可以怎麼玩（fuzz / 攻擊）

```bash
# 讀設施清單
curl localhost:8090/api/config | jq

# 用 Modbus 客戶端把輸液幫浦流速寫成 800 mL/h（Unit 1, Reg 0）→ 觀察藥物過量
python3 -c "from pymodbus.client import ModbusTcpClient as C; c=C('localhost',port=1502); c.write_register(0,800,slave=1)"

# 觸發後端內建攻擊情境
curl -X POST 'localhost:8090/api/attack?facility=mri&type=stopcooling'   # MRI 失超
curl -X POST 'localhost:8090/api/reset?facility=mri'                     # 還原

# CTF：把指定 Coil 寫成 ON 解鎖 flag（見協定文件）
curl 'localhost:8090/api/flag?facility=infusion' | jq
```

Modbus/HL7/DICOM 的 fuzz 進入點、暫存器語意、預期崩潰面，全部整理在 `docs/`。

---

## 📚 文件

| 文件 | 內容 |
|------|------|
| [`docs/01-製作方向.md`](docs/01-製作方向.md) | 架構、資料驅動 Profile、如何新增一台醫療設備 |
| [`docs/02-協定說明.md`](docs/02-協定說明.md) | Modbus 暫存器映射、HL7/MLLP、DICOM、埠號、fuzz 進入點 |
| [`docs/03-Caldera與參考資料.md`](docs/03-Caldera與參考資料.md) | 用 Caldera 做自動化模糊測試的方向、醫療模擬環境參考資料 |
| [`docs/04-交付與安全須知.md`](docs/04-交付與安全須知.md) | git 歷史/IP 注意事項、乾淨匯出、實驗室隔離、負責任揭露 |

---

## 🏗️ 架構一覽

```
┌───────────────── 前端 (React + R3F) ─────────────────┐
│  3D 數位孿生 · 玻璃 HUD · 攻擊模擬台   ← WebSocket ──┐ │
└──────────────────────────────────────────────────────┘ │
                                                          │
┌───────────────── 後端 (Go) ──────────────────────────┐ │
│  facility.BuildAll → GenericFacility ×2               │ │
│    ├─ Modbus/TCP  (依 Unit ID 路由)                   │◀┘
│    ├─ HL7/MLLP    medproto.StartHL7                   │
│    └─ DICOM       medproto.StartDICOM                 │
│  每 100ms 推進物理 → WebSocket 廣播狀態               │
└───────────────────────────────────────────────────────┘
        ▲ Modbus/HL7/DICOM
   學員的 fuzzer / Caldera / Modbus 客戶端
```

設備以「資料驅動 Profile」描述（暫存器映射 + 物理 + 故障規則 + 攻擊注入），由通用引擎 `GenericFacility` 執行。
要加第三台設備，只要新增一個 Profile 並在 `facility.BuildAll()` 掛上——見 `docs/01-製作方向.md`。
