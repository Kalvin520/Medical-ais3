# Medical AIS3 · 虛擬醫院與醫療設備資安靶場

一套供 AIS3 專題與隔離實驗室使用的虛擬醫院資安靶場。專案將完整的 Docker
迷你醫院攻擊鏈，與 Go + React/Three.js 醫療設備數位孿生整合成同一個入口。

> 僅限授權、隔離且不連接真實臨床網路的環境。所有病患、影像、設備與憑證均為合成實驗資料。

## 能做什麼

- 從廠商入口橫向移動到醫療工程工作站。
- 觀察 HL7 → RIS → MRI → PACS → FHIR 的正常醫療資料流。
- 使用 BACnet/IP 改變冷卻狀態，觀察 MRI 進入保護停機。
- 對輸液幫浦與 MRI 周邊 PLC 進行 Modbus/TCP 模糊測試。
- 測試最小 HL7/MLLP 與 DICOM fuzz target。
- 在統一 React/R3F 3D 場景查看服務健康、告警、設備遙測及故障後果。
- 用 Reset Controller 重播同一組合成 Seed，回到可重現基線。

## 統一架構

```text
Browser :8100
  └─ React + React Three Fiber
       ├─ 虛擬醫院總覽（11 個服務節點、資料流、健康狀態）
       ├─ 輸液幫浦數位孿生
       └─ MRI 周邊 PLC 數位孿生
              │ REST / WebSocket
              ▼
       Go medical-target gateway
       ├─ Modbus / HL7 / DICOM 教學 fuzz targets
       └─ /api/hospital/* → lab-scene / reset-controller
                              │
                              ▼
       Docker mini hospital
       ├─ vendor-entry / biomed-ws / protocol-runner
       ├─ hl7-engine / ris-mwl / mri-sim / PACS / FHIR
       └─ BMS / BACnet chiller / reset-controller
```

## 快速開始

需求：

- Docker Desktop 27+ 與 Docker Compose 2.20+

```bash
# Clone 後進入專案根目錄
git clone https://github.com/Kalvin520/Medical-ais3.git
cd Medical-ais3

# 第一次會自動下載基礎映像並建置完整場域
docker compose up -d

# 等健康檢查完成後驗證醫院服務與攻擊鏈前置條件
./lab/scripts/smoke-test.sh
```

開啟：

```text
http://127.0.0.1:8100
```

停止環境：

```bash
docker compose down
```

只有確定要清除所有實驗狀態時，才使用：

```bash
docker compose down -v
```

修改程式後需要強制重建時：

```bash
docker compose up -d --build
```

根目錄的 `docker-compose.yml` 是可攜式一鍵入口，會載入 `lab/docker-compose.yml`
中的完整 16 服務醫院拓撲。所有變數都有隔離靶場預設值；若要自訂，可先執行
`cp .env.example .env`，且不要把產生的 `.env` 提交到 Git。

## 對外 Port

| 用途 | Host Port |
|---|---:|
| 統一 React UI、Go REST、WebSocket | `8100` |
| 設備 PLC Modbus/TCP | `1502` |
| 設備教學 HL7 fuzz target | `2576` |
| 設備教學 DICOM fuzz target | `11113` |
| 醫院 HL7/MLLP | `2575` |
| RIS DICOM / API | `11114` / `8085` |
| PACS DICOM / Web Gateway | `11112` / `8042` |
| FHIR Gateway | `8180`（容器內仍為 `8080`） |
| MRI / BMS / Chiller API | `8090` / `8091` / `8092` |
| Reset Controller | `8099` |
| Vendor / Biomed / Protocol Runner SSH | `2221` / `2222` / `2223` |

`lab-scene` 的 `8100` 只存在 Docker 管理網段；Host 的 `8100` 由統一 Go + React
入口使用，因此不會和舊場景頁衝突。

## 醫療設備 fuzz targets

| Unit | 設施 id | 說明 | 典型危害 |
|---|---|---|---|
| 1 | `infusion` | 輸液幫浦流速、濃度、阻塞閾值 | 過量、阻塞、空氣栓塞 |
| 2 | `mri` | MRI 冷卻、射頻、梯度、門禁 | Quench、SAR 灼傷、投射物 |

設備由 Go 資料驅動 Profile 定義。每 100ms 推進模擬物理，並透過 WebSocket
送往 React 3D 場景。Modbus 依 Unit ID 路由到兩台設備。

## 本機開發模式

不啟動整座 Docker 醫院時，仍可獨立開發設備數位孿生：

```bash
# Terminal 1
cd backend
HTTP_PORT=8090 MODBUS_PORT=1502 HL7_PORT=2576 DICOM_PORT=11113 go run .

# Terminal 2
cd frontend
npm install
npm run dev
```

Vite 開發入口為 `http://127.0.0.1:3000`。醫院總覽會顯示離線；輸液幫浦與
MRI 設備場景仍可使用。

## 驗證

```bash
cd frontend
npm run typecheck
npm run build

cd ../backend
go test ./...

cd ../lab
docker compose config --quiet
./scripts/smoke-test.sh
```

## 文件

- [設備製作方向](docs/01-製作方向.md)
- [Modbus、HL7、DICOM 協定說明](docs/02-協定說明.md)
- [CALDERA 與自動化 fuzzing](docs/03-Caldera與參考資料.md)
- [交付與安全須知](docs/04-交付與安全須知.md)
- [迷你虛擬醫院 PRD](docs/ais3-fuzzy/PRD-迷你虛擬醫院Docker靶場.md)
- [醫院架構圖](docs/ais3-fuzzy/靶場架構圖.md)
- [服務與串接情境](docs/ais3-fuzzy/靶場服務與串接情境.md)
- [CALDERA 對接說明](docs/ais3-fuzzy/CALDERA-對接說明.md)
- [靶機使用方法](docs/ais3-fuzzy/靶機使用方法.md)

## 安全邊界

- 禁止對接真實醫療設備、真實病患資料或正式醫院網路。
- `lab/.env` 被 Git 忽略；實驗用 SSH 私鑰由 Docker named volume 在執行期產生，不會進入原始碼或映像建置內容。
- 專案包含刻意弱密碼、過寬測試 Token 與可寫入 BACnet 物件，只能在隔離靶場使用。
- 攻擊腳本不透過公開 Web API 執行；瀏覽器只取得彙整狀態與可復原的 Reset 操作。
