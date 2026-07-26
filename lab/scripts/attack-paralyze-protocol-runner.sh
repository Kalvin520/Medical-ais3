#!/usr/bin/env bash
# 癱瘓協議工具箱（protocol-runner）測試腳本
# 前提：已取得場域／OT 控制（可達 10.77.50.0/24），對應攻擊鏈後續影響面。
# 僅限隔離實驗室；可還原。
#
# 用法：
#   ./scripts/attack-paralyze-protocol-runner.sh           # 癱瘓 → 驗證失敗 → 自動還原
#   ./scripts/attack-paralyze-protocol-runner.sh --leave   # 癱瘓後不還原（演示用）
#   ./scripts/attack-paralyze-protocol-runner.sh --hard    # 連 SSH 一併停掉（場景頁會變 offline）
#   ./scripts/attack-paralyze-protocol-runner.sh --restore # 僅還原
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEY="${ROOT}/keys/id_ed25519"
RUNNER_IP="${RUNNER_IP:-10.77.50.40}"
MARKER="/opt/hospital/PARALYZED"
BIN_DIR="/opt/hospital/bin"
BIN_BAK="/opt/hospital/bin.paralyzed.bak"
TOOLS=(hl7-send dicom-test-store bacnet-write)

LEAVE=0
HARD=0
RESTORE_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --leave) LEAVE=1 ;;
    --hard) HARD=1 ;;
    --restore) RESTORE_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }
info() { echo "[INFO] $*"; }

runner() {
  docker compose exec -T protocol-runner "$@"
}

tools_callable() {
  local t
  for t in "${TOOLS[@]}"; do
    runner bash -lc "command -v $t >/dev/null && test -x \"\$(command -v $t)\"" \
      || return 1
  done
  return 0
}

probe_tool_smoke() {
  # 輕量探針：僅確認 CLI 能啟動並印出用法／版本，不對臨床系統寫入
  runner bash -lc 'hl7-send --help >/dev/null 2>&1' || return 1
  runner bash -lc 'dicom-test-store --help >/dev/null 2>&1' || return 1
  runner bash -lc 'bacnet-write --help >/dev/null 2>&1' || return 1
  return 0
}

ssh_listening() {
  runner bash -lc "ss -ltn | grep -q ':22 '" || return 1
  return 0
}

restore_runner() {
  info "還原 protocol-runner…"
  runner bash -lc "
    set -e
    if [[ -d '${BIN_BAK}' ]]; then
      rm -rf '${BIN_DIR}'
      mv '${BIN_BAK}' '${BIN_DIR}'
    fi
    ln -sfn '${BIN_DIR}/hl7_send.py' /usr/local/bin/hl7-send
    ln -sfn '${BIN_DIR}/dicom_test_store.py' /usr/local/bin/dicom-test-store
    ln -sfn '${BIN_DIR}/bacnet_write.py' /usr/local/bin/bacnet-write
    chmod +x '${BIN_DIR}'/* 2>/dev/null || true
    rm -f '${MARKER}'
    # 若先前停過 sshd，重啟
    if ! ss -ltn | grep -q ':22 '; then
      /usr/sbin/sshd -D -e >/tmp/sshd-restore.log 2>&1 &
      sleep 1
    fi
  "
  # 硬癱瘓時 container 內 sshd 可能已死；用 compose restart 最穩
  if ! ssh_listening 2>/dev/null; then
    info "sshd 未恢復，restart protocol-runner 容器…"
    docker compose restart protocol-runner >/dev/null
    for _ in $(seq 1 30); do
      ssh_listening 2>/dev/null && break
      sleep 1
    done
  fi
  tools_callable || fail "restore incomplete: tools missing"
  pass "protocol-runner restored"
}

paralyze_runner() {
  info "癱瘓協議 CLI（搬移 ${BIN_DIR} → ${BIN_BAK}）…"
  runner bash -lc "
    set -e
    if [[ -f '${MARKER}' ]]; then
      echo 'already paralyzed'
      exit 0
    fi
    if [[ ! -d '${BIN_DIR}' ]]; then
      echo 'missing ${BIN_DIR}' >&2
      exit 1
    fi
    # 避免重複備份覆蓋
    if [[ -d '${BIN_BAK}' ]]; then
      rm -rf '${BIN_BAK}'
    fi
    mv '${BIN_DIR}' '${BIN_BAK}'
    mkdir -p '${BIN_DIR}'
    # 斷開 PATH 上的 symlink，避免殘留可執行點
    rm -f /usr/local/bin/hl7-send /usr/local/bin/dicom-test-store /usr/local/bin/bacnet-write
    cat > '${MARKER}' <<EOF
paralyzed_at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)
mode=soft
EOF
    echo paralyzed
  "
  if [[ "$HARD" -eq 1 ]]; then
    info "硬模式：停止 sshd（場景頁應顯示協議工具箱 offline）…"
    runner bash -lc "
      echo 'mode=hard' >> '${MARKER}'
      # 殺掉 sshd；之後只能靠 docker exec / compose restart 還原
      pkill -9 sshd || true
    " || true
    sleep 1
  fi
}

# --- main ---

docker compose ps protocol-runner --status running -q | grep -q . \
  || fail "protocol-runner not running (docker compose up -d)"

if [[ "$RESTORE_ONLY" -eq 1 ]]; then
  restore_runner
  probe_tool_smoke || fail "tools still broken after restore"
  pass "tool smoke after restore"
  echo
  echo "=== restore PASSED ==="
  exit 0
fi

info "0) 場域可達性：biomed-ws → protocol-runner:22…"
[[ -f "$KEY" ]] || fail "missing SSH key $KEY"
ssh -i "$KEY" -p 2221 \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
  vendor@127.0.0.1 \
  "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
     biomed@10.77.20.10 \
     'python3 - <<\"PY\"
import socket
s=socket.create_connection((\"${RUNNER_IP}\", 22), timeout=5)
s.close()
print(\"RUNNER_TCP_OK\")
PY'" \
  | grep -q RUNNER_TCP_OK || fail "biomed cannot reach ${RUNNER_IP}:22"
pass "biomed can reach protocol-runner SSH (OT reachability)"

info "1) 基線：協議 CLI 可用…"
tools_callable || fail "baseline tools missing"
probe_tool_smoke || fail "baseline tool smoke failed"
pass "hl7-send / dicom-test-store / bacnet-write callable"

info "2) 執行癱瘓…"
paralyze_runner
pass "paralyze applied"

info "3) 驗證：CLI 應失效…"
if tools_callable 2>/dev/null; then
  fail "tools still callable after paralyze"
fi
if probe_tool_smoke 2>/dev/null; then
  fail "tool smoke unexpectedly succeeded after paralyze"
fi
pass "protocol CLI paralyzed (not callable)"

if [[ "$HARD" -eq 1 ]]; then
  info "3b) 硬模式：SSH 應不再監聽…"
  if ssh_listening 2>/dev/null; then
    fail "sshd still listening after --hard"
  fi
  pass "sshd down (lab-scene should show protocol-runner offline)"
fi

if [[ "$LEAVE" -eq 1 ]]; then
  echo
  echo "=== paralyze APPLIED (--leave) ==="
  echo "還原：./scripts/attack-paralyze-protocol-runner.sh --restore"
  echo "或：  curl -X POST http://127.0.0.1:8099/reset 不會自動還原 runner；請跑 --restore"
  exit 0
fi

info "4) 自動還原並複驗…"
restore_runner
probe_tool_smoke || fail "tools broken after restore"
pass "tools healthy after restore"

echo
echo "=== attack-paralyze-protocol-runner PASSED ==="
echo "提示：演示時可加 --leave 或 --hard；結束後務必 --restore"
