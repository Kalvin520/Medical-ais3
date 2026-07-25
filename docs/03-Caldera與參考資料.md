# 03 · 用 Caldera 做自動化模糊測試 + 醫療模擬環境參考資料

你們的專題是「自動化模糊測試工具開發或應用」，想用 **MITRE Caldera** 擴充醫療相關能力。這份給方向與參考資料——**本靶機不附 Caldera 程式碼**（依需求只交付靶機 + 方向）。

## Caldera 是什麼、缺什麼

- Caldera = MITRE 的**對手模擬 / 自動化紅隊**平台。核心概念：
  - **Agent**（sandcat/植入物）跑在受測主機上，回連 Caldera server 領任務。
  - **Ability**：一個可執行的動作（一段指令/腳本），對應 ATT&CK 技術，有平台/執行器（sh、psh、python…）與 parser（把輸出擷取成 fact）。
  - **Adversary**：把多個 ability 串成一條攻擊鏈。
  - **Fact / Fact source**：ability 之間傳遞的變數（如掃到的 IP、埠、Unit ID）。
- Caldera 內建偏 IT/端點 ATT&CK，**沒有醫材/OT 協定能力**。有一個 OT 外掛群（如社群的 `caldera-ot`，含 Modbus/DNP3/BACnet/IEC-61850 等 ability）可參考，但**沒有 HL7/DICOM，也沒有醫療設備語意**。這正是你們可以補的洞。

## 擴充方向：把「醫療協定 fuzz」做成 Caldera 能力

思路是**把 fuzz 工具包成 ability**，讓 Caldera 自動化「偵察 → 選標的 → fuzz → 觸發危害 → 驗證」。

1. **偵察 ability**：呼叫 `GET /api/config` 或掃 Modbus Unit/HL7/DICOM 埠，把發現的 `facility id`、`unitId`、埠寫成 **fact**（例：`medical.modbus.unit`, `medical.hl7.port`）。
2. **模糊測試 ability**（可平台=python，執行器跑你們寫的 fuzzer）：
   - Modbus：用 `pymodbus`/`boofuzz` 對某 Unit 掃暫存器/功能碼；
   - HL7：對 2575 送 MLLP 變異訊息；
   - DICOM：對 11112 送畸形 PDU。
   - 用前一步的 fact 當輸入（`#{medical.modbus.unit}` 之類的變數插值）。
3. **危害觸發 / 驗證 ability**：`POST /api/attack` 或直接寫危險暫存器，再讀 `GET /api/status` 檢查 `explosionType` 是否進入 `overdose/quench/...`，把結果 parse 成 fact（等於「這台設備被打爆了」的證據）。
4. 用 **Adversary** 把上面三步串起來，對整個「醫院」自動巡一遍。

一個 ability 的骨架（YAML 概念示意，**非本專案檔案**，給你們寫 Caldera 外掛時參考）：
```yaml
- id: <uuid>
  name: Fuzz medical Modbus device
  tactic: impact
  technique: {attack_id: T0836}      # Modify Parameter (ATT&CK for ICS)
  platforms:
    linux:
      python:
        command: python3 fuzz_modbus.py --host #{target.ip} --unit #{medical.modbus.unit}
        parsers:
          plugins.medical.app.parsers.explosion:   # 把 status 的 explosionType 擷取成 fact
            - source: medical.device.impact
```
> ATT&CK for ICS 相關技術可對應：`T0836 Modify Parameter`、`T0855 Unauthorized Command Message`、`T0814 Denial of Service`、`T0831 Manipulation of Control`。醫療情境（過量、失超）屬於「對實體造成危害（Impact）」。

實作 Caldera 外掛的官方文件見下方連結；重點是「新增一個 plugin，放 abilities/ 與 parsers/，掛到 adversary」。

## 建議的模糊測試工具

- **boofuzz**（sulley 後繼）：協定 fuzz 框架，社群有 Modbus/DICOM 範本，可自訂 block/framing（HL7 MLLP、DICOM PDU 都能描述）。
- **AFL++ / libFuzzer**：coverage-guided；把靶機的「PDU/訊息解析函式」抽出來寫成 harness，效果最好（適合 DICOM/HL7 解析器）。
- **pymodbus / pynetdicom / python-hl7 / hl7apy**：手刻合法或畸形訊息的函式庫。
- **Scapy**：自訂封包/畸形框架。
- **Mutiny Fuzzer**（Cisco Talos）：以錄下的合法流量為種子做變異，很適合醫療協定。

## 建置醫療模擬環境 · 參考資料

**協定規格 / 實作**
- HL7 v2 規格與 MLLP：HL7.org；`python-hl7`、`hl7apy`、`HAPI`（Java）可產測試訊息與模擬端點。
- DICOM 標準（PS3.7 上層協定、PS3.8 網路）：`dicomstandard.org`；`pynetdicom`、`dcmtk`（`storescp`/`echoscu`）可當真實對照端。
- Modbus：`modbus.org` 規格；`pymodbus`、`ModbusPal`、`conpot`（ICS honeypot，可延伸醫療語意）。

**醫療設備 / 醫院模擬環境**
- Conpot / GridPot：ICS honeypot 框架，可做為「假設備」骨架再套醫療語意。
- MedShield / 各家「hospital cyber range」論文與開源專案：搜 "medical device cyber range"、"healthcare ICS testbed"。
- 真實醫材協定測試常用 `dcmtk`（DICOM）、Mirth Connect（HL7 整合引擎，可當測試 peer）。

**攻擊框架 / 知識庫**
- MITRE ATT&CK for ICS（含 Impair Process Control / Impact 戰術）。
- MITRE Caldera 官方文件 + `caldera-ot` 外掛（Modbus/DNP3… 可參考其 ability 寫法）。
- FDA Premarket/Postmarket Cybersecurity 指引、IEC 80001、IEC 62443（你們課程主題）。

**真實案例 / 威脅情資（寫報告很好用）**
- 輸液幫浦漏洞：Hospira/BD Alaris 等歷年 CVE、ICS-CERT/ICS-MEDICAL advisories（搜 "infusion pump CVE ICSMA"）。
- MEDJACK（Medical Device Hijack）系列報告。
- DICOM 檔頭可藏 PE 的 "PE/DICOM" 問題（Cylera 研究）。
- Urgent/11、Ripple20 等影響醫材的 TCP/IP stack 漏洞。

> 寫論文時，把「本靶機的模擬情境」對應到上面的真實 CVE/案例，會很有說服力：例如 `overinfuse` ↔ 輸液幫浦劑量竄改 advisory；`unlockdoor`/`projectile` ↔ MRI 鐵磁投射物安全事件；`quench` ↔ 冷卻/液氦系統可用性攻擊。
