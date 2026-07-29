FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server openssh-client sshpass iproute2 iputils-ping curl ca-certificates netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd /home/vendor/.ssh /opt/hospital

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
