ARG BASE_IMAGE=node:24.15.0-bookworm-slim
FROM ${BASE_IMAGE}

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates clamav-daemon clamav-freshclam qpdf util-linux \
    && rm -rf /var/lib/apt/lists/* /var/log/clamav/*

WORKDIR /opt/flowboard-scanner
COPY scanner.cjs entrypoint.sh ./
COPY clamd.conf freshclam.conf ./
ENV TZ=UTC
USER 10001:10003
ENTRYPOINT ["/opt/flowboard-scanner/entrypoint.sh"]
