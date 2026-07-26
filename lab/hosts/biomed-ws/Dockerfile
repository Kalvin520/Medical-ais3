FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server iproute2 iputils-ping curl ca-certificates netcat-openbsd \
    python3 python3-pip dcmtk \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd /opt/hospital/creds /opt/hospital/agent

COPY hosts/biomed-ws/entrypoint.sh /entrypoint.sh
COPY hosts/biomed-ws/creds/ /opt/hospital/creds/
COPY seed/ /opt/hospital/seed/
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
