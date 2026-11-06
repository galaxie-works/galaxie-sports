#!/bin/sh
# Grava o token de /metrics (METRICS_TOKEN do Portainer) onde o prometheus.yml espera e inicia o Prometheus.
# Retenção: 35 dias, para a janela de 28 dias dos SLOs valer inteira, e teto de 2 GB no disco como proteção
# (docs/14-slos-e-error-budget.md › Retenção do Prometheus).
set -eu
umask 077
printf '%s' "${METRICS_TOKEN:-}" >/tmp/metrics-token
exec /bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-35d}" \
  --storage.tsdb.retention.size="${PROMETHEUS_RETENTION_SIZE:-2GB}" \
  "$@"
