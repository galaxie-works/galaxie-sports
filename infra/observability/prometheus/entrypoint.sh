#!/bin/sh
# Grava o token de /metrics (METRICS_TOKEN do Portainer) onde o prometheus.yml espera e inicia o Prometheus.
set -eu
umask 077
printf '%s' "${METRICS_TOKEN:-}" >/tmp/metrics-token
exec /bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-15d}" \
  "$@"
