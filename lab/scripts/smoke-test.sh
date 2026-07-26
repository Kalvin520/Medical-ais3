#!/usr/bin/env bash
# 正常醫院流程自檢（ENV-03）+ SSH 橫向（ENV-04／05）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PACS_USER="${PACS_USER:-overprivileged}"
PACS_PASS="${PACS_PASS:-lab-dicomweb-token-overprivileged}"
FHIR_TOKEN="${FHIR_TOKEN:-lab-fhir-token-overprivileged}"
FHIR_HOST_PORT="${FHIR_HOST_PORT:-8180}"
FHIR_BASE="http://127.0.0.1:${FHIR_HOST_PORT}/fhir"

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
info() { echo "[INFO] $*"; }

info "等待服務就緒…"
for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8099/health >/dev/null \
    && curl -sf http://127.0.0.1:8085/health >/dev/null \
    && curl -sf -u "${PACS_USER}:${PACS_PASS}" http://127.0.0.1:8042/system >/dev/null \
    && curl -sf -H "Authorization: Bearer ${FHIR_TOKEN}" "${FHIR_BASE}/metadata" >/dev/null \
    && curl -sf http://127.0.0.1:8090/health >/dev/null \
    && curl -sf http://127.0.0.1:8091/health >/dev/null; then
    break
  fi
  sleep 3
  [[ $i -eq 90 ]] && fail "services not ready"
done
pass "core APIs reachable"

info "ENV-04/05：vendor-entry → biomed-ws SSH 橫向 + creds…"
docker compose exec -T --user vendor vendor-entry \
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
  biomed@10.77.20.10 \
  'test -s /opt/hospital/creds/fhir.token && test -s /opt/hospital/creds/dicomweb.token && grep -q HL7_ENDPOINT /opt/hospital/creds/endpoints.env && echo CREDS_OK' \
  | grep -q CREDS_OK || fail "lateral SSH or creds seed failed"
pass "SSH lateral vendor→biomed + /opt/hospital/creds present"

info "執行 reset（播種基線）…"
RESET_JSON="$(curl -sf -X POST http://127.0.0.1:8099/reset)"
echo "$RESET_JSON" | grep -q '"ok": true\|"ok":true' || fail "reset failed: $RESET_JSON"
pass "reset ok"

info "檢查 RIS worklist…"
WL="$(curl -sf http://127.0.0.1:8085/worklist)"
echo "$WL" | grep -q 'patient-001' || fail "worklist missing patient-001: $WL"
pass "worklist has patient-001"

info "檢查 MRI READY…"
MRI="$(curl -sf http://127.0.0.1:8090/status)"
echo "$MRI" | grep -q 'READY' || fail "MRI not READY: $MRI"
echo "$MRI" | grep -q 'NORMAL' || fail "cooling not NORMAL: $MRI"
pass "MRI READY / cooling NORMAL"

info "檢查 Orthanc studies（需 HTTP Basic）…"
STUDIES="$(curl -sf -u "${PACS_USER}:${PACS_PASS}" http://127.0.0.1:8042/studies)"
[[ "$STUDIES" != "[]" ]] || fail "no studies in PACS"
pass "PACS has baseline study"

info "檢查 FHIR Patient（需過寬 Bearer）…"
FHIR="$(curl -sf -H "Authorization: Bearer ${FHIR_TOKEN}" \
  "${FHIR_BASE}/Patient/patient-001")"
echo "$FHIR" | grep -q 'patient-001' || fail "FHIR patient missing"
pass "FHIR Patient/patient-001 present"

info "檢查無 Token 應被拒…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "${FHIR_BASE}/Patient/patient-001" || true)"
[[ "$CODE" == "401" ]] || fail "expected FHIR 401 without token, got $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8042/studies || true)"
[[ "$CODE" == "401" ]] || fail "expected Orthanc 401 without auth, got $CODE"
pass "unauthenticated FHIR/Orthanc rejected"

echo
echo "=== smoke-test PASSED ==="
