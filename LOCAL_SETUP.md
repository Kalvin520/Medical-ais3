# Medical AIS3 本地端啟動指南

本專案合併了兩個部分：

1. React + Three.js 前端與 Go 醫療設備模擬器。
2. Docker 迷你虛擬醫院，包括 PACS、FHIR、HL7、RIS/MWL、MRI、BMS、冷卻機與橫向移動環境。

若要使用所有獨立 3D 場域、即時遙測、警報、攻擊模擬與協議工具箱，請使用
「完整 Docker 模式」。

---

## 一、環境需求

### 完整 Docker 模式

- macOS、Linux 或 Windows + WSL2
- Docker Desktop 27 或更新版本
- Docker Compose v2
- Git
- 建議至少 8 GB RAM

確認 Docker 可以使用：

```bash
docker --version
docker compose version
```

### 傳統 frontend + backend 模式

- Node.js 22
- npm
- Go 1.25

確認版本：

```bash
node --version
npm --version
go version
```

---

## 二、完整啟動合併後靶場（推薦）

這個模式會啟動：

- 統一 React / React Three Fiber 前端
- Go REST API、WebSocket 與設備模擬器
- 輸液幫浦病房
- 核磁共振 MRI
- 迷你虛擬醫院總覽
- 所有拆分的醫院設備 3D 場域
- Vendor Entry、Biomed Workstation 與 Protocol Runner
- HL7 Engine、RIS/MWL、PACS、FHIR
- BMS、BACnet 冷卻機與內部 Reset Controller

### 第一次啟動

在 Terminal 執行：

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab

# 建立不會提交到 Git 的 lab/.env
./scripts/init-lab.sh

# 建置並啟動完整靶場
docker compose up -d --build
```

等待容器健康檢查完成：

```bash
docker compose ps
```

當主要服務顯示 `Up` 或 `healthy` 後，開啟：

```text
http://127.0.0.1:8100
```

macOS 也可以直接執行：

```bash
open http://127.0.0.1:8100
```

### 驗證靶場

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
./scripts/smoke-test.sh
```

### 查看執行紀錄

查看統一 UI 與 Go 後端：

```bash
docker compose logs -f medical-target
```

查看醫院遙測聚合器：

```bash
docker compose logs -f lab-scene
```

查看所有服務：

```bash
docker compose logs -f
```

按 `Control + C` 只會離開紀錄畫面，不會停止容器。

### 修改程式後重新建置

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
docker compose up -d --build medical-target
```

若同時修改了 `lab/services` 或其他 Docker 服務，請重建全部：

```bash
docker compose up -d --build
```

### 停止完整靶場

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
docker compose down
```

一般停止請不要加入 `-v`。

只有確定要清除實驗資料、Docker Volume 與執行時產生的 SSH Key，才使用：

```bash
docker compose down -v
```

---

## 三、傳統 frontend + backend 啟動方式

這個方式與原始專案的啟動方式相近：

```bash
cd frontend
npm install
npm run build
cd ../backend
go run .
```

為避免使用系統特權 Port，建議明確指定本專案的開發 Port：

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/frontend
npm install
npm run build

cd ../backend
HTTP_PORT=8090 \
MODBUS_PORT=1502 \
HL7_PORT=2576 \
DICOM_PORT=11113 \
go run .
```

開啟：

```text
http://127.0.0.1:8090
```

Go 後端會直接提供 `frontend/dist` 中已建置的前端檔案，所以這個模式只需要一個
持續執行的 Go Terminal。

### 這個模式的限制

只使用 `npm run build` 與 `go run .` 時，不會啟動 Docker 迷你醫院服務。

以下功能會顯示離線或無法使用：

- 醫院總覽即時狀態
- PACS、FHIR、HL7 Engine 與 RIS/MWL
- Vendor 到 Biomed 的橫向移動
- 協議工具箱
- BMS 與 BACnet 冷卻攻擊
- 所有依賴 Docker 醫院服務的攻擊模擬

輸液幫浦、MRI 設備模擬、Modbus、教學用 HL7/DICOM 及 WebSocket 仍可使用。

按 `Control + C` 可停止 `go run .`。

---

## 四、前端開發模式

若只需要即時修改前端，可以使用兩個 Terminal。

### Terminal 1：Go 後端

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/backend
HTTP_PORT=8090 \
MODBUS_PORT=1502 \
HL7_PORT=2576 \
DICOM_PORT=11113 \
go run .
```

### Terminal 2：Vite 前端

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/frontend
npm install
npm run dev
```

開啟 Vite 開發頁面：

```text
http://127.0.0.1:3000
```

Vite 會將 `/api` 與 `/ws` 轉送到 `http://127.0.0.1:8090`。

---

## 五、不要同時啟動兩種模式

Docker 完整模式與本機 `go run .` 會使用部分相同的 Port。

如果 Docker 仍在執行，又啟動本機 Go 後端，可能看到：

```text
bind: address already in use
```

要改用本機 frontend + backend 模式前，先停止 Docker：

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
docker compose down
```

要改回 Docker 完整模式前，先在執行 `go run .` 的 Terminal 按：

```text
Control + C
```

---

## 六、常用 Port

| 用途 | Port |
|---|---:|
| Docker 完整靶場入口 | `8100` |
| 本機 Go UI / API / WebSocket | `8090` |
| Vite 前端開發伺服器 | `3000` |
| 設備 Modbus/TCP | `1502` |
| 設備 HL7 fuzz target | `2576` |
| 設備 DICOM fuzz target | `11113` |
| 醫院 HL7/MLLP | `2575` |
| PACS DICOM / Web | `11112` / `8042` |
| FHIR Gateway | `8180` |
| MRI / BMS / Chiller API | `8090` / `8091` / `8092` |
| Vendor / Biomed / Protocol Runner SSH | `2221` / `2222` / `2223` |

---

## 七、Port 被占用

先查詢是哪個程式占用 Port：

```bash
lsof -nP -iTCP:8090 -sTCP:LISTEN
lsof -nP -iTCP:8100 -sTCP:LISTEN
lsof -nP -iTCP:11112 -sTCP:LISTEN
lsof -nP -iTCP:2575 -sTCP:LISTEN
```

如果是本專案先前啟動的 Docker 容器：

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
docker compose down
```

如果是先前執行的 `go run .`，回到該 Terminal 按 `Control + C`。

---

## 八、程式碼驗證

### 前端

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/frontend
npm run typecheck
npm run build
```

### Go 後端

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/backend
go test ./...
```

### Docker Compose

```bash
cd /Users/kalvin/Desktop/Project/medical-target-ais3/lab
docker compose config --quiet
```

---

## 九、建議使用方式

- 展示完整專題、攻擊鏈與所有 3D 場域：使用 Docker 完整模式，開啟 `8100`。
- 只修改輸液幫浦或 MRI 核心：使用本機 frontend + backend 模式，開啟 `8090`。
- 只調整 React UI：使用 Vite 開發模式，開啟 `3000`。
- 不要將本靶場連接到真實醫院、臨床網路或未授權設備。
