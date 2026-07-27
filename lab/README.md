# 迷你虛擬醫院 Docker 靶場（lab）

依據：[PRD-迷你虛擬醫院Docker靶場.md](../docs/ais3-fuzzy/PRD-迷你虛擬醫院Docker靶場.md)  
架構圖：[靶場架構圖.md](../docs/ais3-fuzzy/靶場架構圖.md)  
服務與串接：[靶場服務與串接情境.md](../docs/ais3-fuzzy/靶場服務與串接情境.md)  
CALDERA 對接：[CALDERA-對接說明.md](../docs/ais3-fuzzy/CALDERA-對接說明.md)  
**使用方法：[靶機使用方法.md](../docs/ais3-fuzzy/靶機使用方法.md)**

> 僅限隔離實驗室。合成病患／影像／設備；禁止連接真實醫院網路。不含 CALDERA。

## 快速開始

```bash
cd lab
./scripts/init-lab.sh
docker compose up -d --build

# 等服務就緒後自檢（含 SSH 橫向、Token 真授權）
./scripts/smoke-test.sh

# 手動攻擊鏈（不依賴 CALDERA；含真 BACnet）
./scripts/attack-manual-demo.sh

# 癱瘓協議工具箱（可還原；演示可加 --leave / --hard）
./scripts/attack-paralyze-protocol-runner.sh

# 一鍵重置
curl -X POST http://127.0.0.1:8099/reset

# 統一 React/R3F 醫院場域與設備數位孿生
open http://127.0.0.1:8100
```

## 服務與 Port

| 服務 | 容器 IP | Host Port |
|---|---|---|
| medical-target（統一 UI/API） | 10.77.99.12 | **8100** |
| vendor-entry | 10.77.10.20 | SSH 2221 |
| biomed-ws | 10.77.20.10 | SSH 2222 |
| fhir-gw（Bearer 閘道） | 10.77.20.20 | 8180（容器內 8080） |
| ehr-fhir（HAPI，僅管理網） | 10.77.99.20 | （不直接對外） |
| hl7-engine | 10.77.30.10 | MLLP 2575 / API 8075 |
| ris-mwl | 10.77.30.20 | DICOM 11114 / API 8085 |
| pacs (Orthanc DIMSE) | 10.77.40.10 | DICOM 11112 |
| pacs-gw（HTTP Basic＋scope） | 10.77.40.12 | HTTP **8042** |
| mri-sim | 10.77.40.20 | 8090 |
| bms | 10.77.50.10 | 8091 |
| chiller-sim（bacpypes3） | 10.77.50.20 | 8092（BACnet/IP UDP 47808 網內） |
| protocol-runner | 10.77.50.40 | SSH 2223 |
| reset-controller | 10.77.99.10 | 8099 |
| lab-scene（狀態聚合器） | 10.77.99.11 | 僅容器內 `8100` |
| device fuzz targets | 10.77.99.12 | Modbus 1502 / HL7 2576 / DICOM 11113 |

## 實驗室帳密（刻意弱點）

| 主機 | 使用者 | 密碼 |
|---|---|---|
| vendor-entry | vendor | Vendor@123 |
| biomed-ws | biomed | Vendor@123 |
| protocol-runner | runner | Runner@123 |

### Token／HTTP 授權（V-07／V-08）

| 用途 | 憑證 | 能力 |
|---|---|---|
| FHIR 過寬 | `Bearer lab-fhir-token-overprivileged` | 廣查所有合成 Patient |
| FHIR 窄 scope | `Bearer lab-fhir-token-patient001` | 僅 `Patient/patient-001` |
| Orthanc／DICOMweb 過寬 | Basic `overprivileged` / `lab-dicomweb-token-overprivileged` | 廣查 studies |
| Orthanc／DICOMweb 窄 scope | Basic `scoped` / `lab-dicomweb-token-patient001` | 需帶 `PatientID=patient-001` |

憑證在 biomed：`/opt/hospital/creds/`。

### BACnet（V-09）

- Device `42001`，物件 `binary-value,1`（`inactive`=NORMAL，`active`=ALARM）
- `bacnet-write --via bacnet`（預設）或 `--via bms`（HTTP 雙軌）

```bash
# Host 端先用刻意保留的實驗密碼登入
ssh -p 2221 vendor@127.0.0.1
ssh biomed@10.77.20.10
cat /opt/hospital/creds/endpoints.env
```

共用 SSH 私鑰由 `lab-keys` named volume 在啟動時產生，供
`vendor-entry` 橫向連線 `biomed-ws`；不會寫入 Host 專案目錄。

## 停止

```bash
docker compose down
docker compose down -v   # 連 volume 清除
```
