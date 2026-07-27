# Medical AIS3 跨平台 Docker 交付指南

這份交付支援同一套 Linux containers 在以下環境執行：

| Host | Docker 平台 | 映像架構 |
|---|---|---|
| Linux x86-64 | Docker Engine | `linux/amd64` |
| Linux ARM64 | Docker Engine | `linux/arm64` |
| macOS Intel | Docker Desktop | `linux/amd64` |
| macOS Apple Silicon | Docker Desktop | `linux/arm64` |
| Windows x86-64 | Docker Desktop WSL2 / Linux containers | `linux/amd64` |
| Windows ARM64 | Docker Desktop WSL2 / Linux containers | `linux/arm64` |

Docker 映像不是 Windows `.exe` 或 macOS `.app`。跨平台交付由 Compose YAML、
多架構 OCI/Docker 映像與 PowerShell/POSIX 啟動腳本組成。

## 1. 一般使用者：使用預建映像

需求：

- Docker Engine 或 Docker Desktop
- Docker Compose 2.20+
- Windows 必須使用 Linux containers
- 建議至少 8 GB RAM

Linux / macOS：

```bash
./scripts/start.sh
```

Windows PowerShell：

```powershell
.\scripts\start.ps1
```

腳本會先執行 `docker compose pull`，再使用：

```text
docker compose up -d --no-build --pull never
```

這可確保啟動階段只使用已打包映像，不會因本機 DNS、Go proxy、npm registry
或 PyPI 連線問題退回原始碼建置。

預設映像位置由 `.env.example` 定義：

```dotenv
IMAGE_REGISTRY=ghcr.io/kalvin520
IMAGE_PREFIX=medical-ais3
IMAGE_TAG=main
```

若使用版本化 release，建立 `.env` 並修改 `IMAGE_TAG` 即可。

## 2. 開發者：從原始碼建置

只有修改程式碼或 Dockerfile 時才使用：

```bash
docker compose -f docker-compose.build.yml up -d --build
```

這個模式需要正常存取 Docker Hub、npm registry、PyPI 及 Debian/Alpine
套件來源。

Go 的公開模組已提交在 `backend/vendor/`，因此 `medical-target` 的 Go 編譯
不需要連線 `proxy.golang.org`。npm、PyPI 與作業系統套件仍由集中式映像
發布流程下載；一般使用者不會執行這些建置步驟。

## 3. 產生離線映像包

映像包必須與目標 CPU 架構相同。Windows x86-64、Intel Mac 與一般 x86-64
Linux 共用 AMD64 包；Apple Silicon 與 ARM64 Linux 共用 ARM64 包。

Linux / macOS：

```bash
./scripts/export-images.sh
```

輸出：

```text
dist/medical-ais3-images-amd64.tar
dist/medical-ais3-images-amd64.tar.sha256
```

Apple Silicon/ARM64 的檔名會是 `medical-ais3-images-arm64.tar`。

Windows PowerShell：

```powershell
.\scripts\export-images.ps1
```

也可以自訂輸出路徑：

```powershell
.\scripts\export-images.ps1 -Output D:\delivery\medical-ais3-images-amd64.tar
```

若映像是剛由 `docker buildx bake --load` 建立、尚未發布至 registry，可以使用
本機映像模式（所有 Compose runtime images 必須已存在）：

```bash
SKIP_PULL=true ./scripts/export-images.sh
```

```powershell
.\scripts\export-images.ps1 -Local
```

## 4. 離線載入與啟動

Linux / macOS：

```bash
./scripts/load-images.sh /path/to/medical-ais3-images-amd64.tar
```

Windows PowerShell：

```powershell
.\scripts\load-images.ps1 -Archive D:\delivery\medical-ais3-images-amd64.tar
```

載入完成後，腳本會以 offline 模式啟動：

```text
docker compose up -d --no-build --pull never
```

GitHub Actions 下載的 `.tar.gz` 也可以直接交給 `docker load` 與上述載入腳本。

## 5. 建立並發布多架構映像

本機檢查 Buildx 設定：

```bash
docker buildx bake --file docker-bake.hcl --print
```

發布所有自建映像：

```bash
docker login ghcr.io
IMAGE_REGISTRY=ghcr.io/kalvin520 \
IMAGE_PREFIX=medical-ais3 \
IMAGE_TAG=main \
docker buildx bake --file docker-bake.hcl --push
```

`docker-bake.hcl` 會為 14 個自建映像同時發布：

```text
linux/amd64
linux/arm64
```

推送到 GitHub `main` 後，`.github/workflows/docker-multiarch.yml` 也會自動執行
相同流程。手動執行 workflow 時可以指定版本 tag，並選擇是否額外產生 AMD64
與 ARM64 離線 image bundles。

## 6. 驗證

查看服務：

```bash
docker compose ps
```

驗證統一入口：

```bash
curl -fsS http://127.0.0.1:8100/api/config
curl -fsS http://127.0.0.1:8100/api/hospital/health
```

Linux / macOS 可執行完整 smoke test：

```bash
./lab/scripts/smoke-test.sh
```

Windows 可在 WSL2 中執行同一支 smoke test，或使用瀏覽器開啟：

```text
http://127.0.0.1:8100
```

## 7. 常見問題

### Windows 顯示 Windows container 錯誤

在 Docker Desktop 切換為 Linux containers，再執行 `start.ps1`。

### 預建映像無權限或不存在

確認 GitHub Container Registry package 已發布，且 visibility 允許目標使用者
讀取。若 package 為 private，先執行：

```text
docker login ghcr.io
```

### 企業或 ISP 網路攔截套件站台

一般使用者應執行 `start.sh`/`start.ps1` 下載預建映像，不要執行
`docker-compose.build.yml`。完全無法連線 registry 時，改用離線映像包。

### 停止與清除

停止但保留實驗資料：

```bash
docker compose down
```

只有確定要刪除 Volume、Seed 狀態與執行期 SSH Key 時才使用：

```bash
docker compose down -v
```
