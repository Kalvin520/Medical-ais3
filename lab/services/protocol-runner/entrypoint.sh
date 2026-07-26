#!/bin/bash
set -euo pipefail

SSH_USER="${SSH_USER:-runner}"
SSH_PASS="${SSH_PASS:-Runner@123}"

if ! id "$SSH_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$SSH_USER"
fi
echo "${SSH_USER}:${SSH_PASS}" | chpasswd

mkdir -p "/home/${SSH_USER}/.ssh" /opt/hospital/agent
chown -R "${SSH_USER}:${SSH_USER}" "/home/${SSH_USER}"

sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

echo 'export PATH=/opt/hospital/bin:$PATH' > /etc/profile.d/hospital.sh

# Status API lives outside /opt/hospital/bin so soft paralyze does not remove it
install -m 0755 /opt/hospital/statusd.py /usr/local/bin/protocol-statusd 2>/dev/null || true
if [[ -f /opt/hospital/statusd.py ]]; then
  python3 /opt/hospital/statusd.py &
fi

exec /usr/sbin/sshd -D -e
