#!/bin/sh
# Entrada do Grafana do Galaxie Sports: monta o provisionamento num diretório gravável e, com e-mail e SMTP
# configurados, liga o envio dos alertas. Depois segue para o /run.sh da imagem oficial.
#   ALERT_EMAIL_TO       destino (vários: separados por ;)
#   ALERT_SMTP_HOST      host:porta do SMTP (ex.: smtp.exemplo.com:587, STARTTLS quando o servidor oferece)
#   ALERT_SMTP_USER      usuário do SMTP (opcional)
#   ALERT_SMTP_PASSWORD  senha do SMTP (opcional; só no .env da VPS, nunca no repositório)
#   ALERT_EMAIL_FROM     remetente (padrão: ALERT_SMTP_USER)
# Sem ALERT_EMAIL_TO ou ALERT_SMTP_HOST, os alertas continuam visíveis no Grafana (Alerting → Alert rules) e no
# Prometheus, sem notificação.
set -eu
dir=/tmp/grafana-provisioning
rm -rf "$dir"
cp -R /etc/grafana/provisioning "$dir"

if [ -n "${ALERT_EMAIL_TO:-}" ] && [ -n "${ALERT_SMTP_HOST:-}" ]; then
  cp /etc/grafana/alerting-email/*.yml "$dir/alerting/"
  export GF_SMTP_ENABLED=true
  export GF_SMTP_HOST="$ALERT_SMTP_HOST"
  export GF_SMTP_USER="${ALERT_SMTP_USER:-}"
  export GF_SMTP_PASSWORD="${ALERT_SMTP_PASSWORD:-}"
  export GF_SMTP_FROM_ADDRESS="${ALERT_EMAIL_FROM:-${ALERT_SMTP_USER:-}}"
  export GF_SMTP_FROM_NAME="${GF_SMTP_FROM_NAME:-Galaxie Sports alertas}"
  echo "alertas por e-mail ligados (SMTP $ALERT_SMTP_HOST)"
else
  echo "alertas sem e-mail: defina ALERT_EMAIL_TO e ALERT_SMTP_HOST para notificar (os alertas seguem visíveis no Grafana)"
fi
unset ALERT_SMTP_PASSWORD

export GF_PATHS_PROVISIONING="$dir"
exec /run.sh "$@"
