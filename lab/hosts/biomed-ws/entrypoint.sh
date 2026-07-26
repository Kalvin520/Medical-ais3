#!/bin/bash
set -euo pipefail

BIOMED_USER="${BIOMED_USER:-biomed}"
BIOMED_PASS="${BIOMED_PASS:-Vendor@123}"

if ! id "$BIOMED_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$BIOMED_USER"
fi
echo "${BIOMED_USER}:${BIOMED_PASS}" | chpasswd
echo "root:${BIOMED_PASS}" | chpasswd

mkdir -p "/home/${BIOMED_USER}/.ssh" /opt/hospital/creds /opt/hospital/agent
chmod 700 "/home/${BIOMED_USER}/.ssh"

if [[ -f /opt/hospital/keys/id_ed25519.pub ]]; then
  cat /opt/hospital/keys/id_ed25519.pub > "/home/${BIOMED_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${BIOMED_USER}/.ssh/authorized_keys"
fi

# Inject tokens from env into cred files (V-03 / V-07 / V-08)
cat > /opt/hospital/creds/endpoints.env <<EOF
HL7_ENDPOINT=10.77.30.10:2575
HL7_API=http://10.77.30.10:8075
RIS_URL=http://10.77.30.20:8080
PACS_DIMSE=10.77.40.10:11112
PACS_AE=HOSP_PACS
PACS_HTTP=http://10.77.40.12:8042
DICOMWEB=http://10.77.40.12:8042/dicom-web
DICOMWEB_USER=overprivileged
FHIR_URL=http://10.77.20.20:8080/fhir
BMS_URL=http://10.77.50.10:8091
CHILLER_URL=http://10.77.50.20:8092
CHILLER_BACNET=10.77.50.20:47808
CHILLER_DEVICE_ID=42001
CHILLER_BV=binary-value,1
MRI_URL=http://10.77.40.20:8090
PROTOCOL_RUNNER=10.77.50.40
EOF

echo -n "${DICOMWEB_TEST_TOKEN:-lab-dicomweb-token-overprivileged}" > /opt/hospital/creds/dicomweb.token
echo -n "${DICOMWEB_SCOPED_TOKEN:-lab-dicomweb-token-patient001}" > /opt/hospital/creds/dicomweb-scoped.token
echo -n "${FHIR_TEST_TOKEN:-lab-fhir-token-overprivileged}" > /opt/hospital/creds/fhir.token
echo -n "${FHIR_SCOPED_TOKEN:-lab-fhir-token-patient001}" > /opt/hospital/creds/fhir-scoped.token
echo -n "overprivileged" > /opt/hospital/creds/dicomweb.user
echo -n "scoped" > /opt/hospital/creds/dicomweb-scoped.user
chmod -R a+rX /opt/hospital/creds

chown -R "${BIOMED_USER}:${BIOMED_USER}" "/home/${BIOMED_USER}"

sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

cat > /opt/hospital/README.txt <<EOF
Mini Hospital Lab - biomed-ws
Creds: /opt/hospital/creds/
Agent install path: /opt/hospital/agent/
EOF

exec /usr/sbin/sshd -D -e
