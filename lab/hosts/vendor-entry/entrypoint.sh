#!/bin/bash
set -euo pipefail

VENDOR_USER="${VENDOR_USER:-vendor}"
VENDOR_PASS="${VENDOR_PASS:-Vendor@123}"
BIOMED_HOST="${BIOMED_HOST:-10.77.20.10}"

if ! id "$VENDOR_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$VENDOR_USER"
fi
echo "${VENDOR_USER}:${VENDOR_PASS}" | chpasswd
echo "root:${VENDOR_PASS}" | chpasswd

mkdir -p "/home/${VENDOR_USER}/.ssh" /opt/hospital/agent
chmod 700 "/home/${VENDOR_USER}/.ssh"

if [[ -f /opt/hospital/keys/id_ed25519.pub ]]; then
  cat /opt/hospital/keys/id_ed25519.pub > "/home/${VENDOR_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${VENDOR_USER}/.ssh/authorized_keys"
fi

# V-02 helper: shared key for lateral SSH to biomed
if [[ -f /opt/hospital/keys/id_ed25519 ]]; then
  cp /opt/hospital/keys/id_ed25519 "/home/${VENDOR_USER}/.ssh/id_ed25519"
  chmod 600 "/home/${VENDOR_USER}/.ssh/id_ed25519"
  cat > "/home/${VENDOR_USER}/.ssh/config" <<EOF
Host biomed biomed-ws
  HostName ${BIOMED_HOST}
  User biomed
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
EOF
  chmod 600 "/home/${VENDOR_USER}/.ssh/config"
fi

chown -R "${VENDOR_USER}:${VENDOR_USER}" "/home/${VENDOR_USER}"

# Lab-only: password auth enabled (V-01)
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

cat > /opt/hospital/README.txt <<EOF
Mini Hospital Lab - vendor-entry (initial foothold)
SSH lateral: ssh biomed@${BIOMED_HOST}  (password ${VENDOR_PASS} or shared key)
Agent install path: /opt/hospital/agent/
EOF

exec /usr/sbin/sshd -D -e
