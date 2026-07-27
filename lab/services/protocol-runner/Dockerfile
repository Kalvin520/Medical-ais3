FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server iproute2 iputils-ping curl ca-certificates netcat-openbsd \
    python3 python3-pip dcmtk \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir \
        httpx==0.28.1 hl7==0.4.5 pydicom==3.0.2 \
        pynetdicom==3.0.4 bacpypes3==0.0.106 \
    && mkdir -p /var/run/sshd /opt/hospital/bin /opt/hospital/agent

COPY services/protocol-runner/bin/ /opt/hospital/bin/
COPY services/protocol-runner/statusd.py /opt/hospital/statusd.py
COPY services/protocol-runner/entrypoint.sh /entrypoint.sh
COPY seed/ /opt/hospital/seed/
COPY scripts/ /opt/hospital/scripts/
RUN chmod +x /entrypoint.sh /opt/hospital/bin/* /opt/hospital/statusd.py \
    && chmod +x /opt/hospital/scripts/*.sh \
    && ln -sf /opt/hospital/bin/hl7_send.py /usr/local/bin/hl7-send \
    && ln -sf /opt/hospital/bin/bacnet_write.py /usr/local/bin/bacnet-write \
    && ln -sf /opt/hospital/bin/dicom_test_store.py /usr/local/bin/dicom-test-store

EXPOSE 22 8093
CMD ["/entrypoint.sh"]
