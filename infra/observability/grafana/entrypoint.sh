#!/bin/sh
# Entrada do Grafana do Galaxie Sports: monta o provisionamento num diretório gravável, liga os canais de alerta
# configurados e segue para o /run.sh da imagem oficial. Runbook: docs/runbooks/alertas-e-monitoramento.md.
#
# Push (crítico, na hora; ntfy):
#   ALERT_NTFY_URL       tópico do ntfy, ex.: https://ntfy.sh/<nome-secreto-e-longo> (o nome do tópico é a senha)
#   ALERT_NTFY_TOKEN     token de acesso (opcional: servidor próprio ou tópico reservado)
# E-mail (resumo diário às 08:00 de Brasília):
#   ALERT_EMAIL_TO       destino (vários: separados por ;)
#   ALERT_SMTP_HOST      host:porta do SMTP (ex.: smtp.exemplo.com:587, STARTTLS quando o servidor oferece)
#   ALERT_SMTP_USER      usuário do SMTP (opcional)
#   ALERT_SMTP_PASSWORD  senha do SMTP (opcional; só no .env da VPS, nunca no repositório)
#   ALERT_EMAIL_FROM     remetente (padrão: ALERT_SMTP_USER)
# Issue no GitHub (cada alerta abre uma issue com o rótulo `alerta` e ela fecha quando resolve; alerta-grafana.yml):
#   ALERT_GITHUB_TOKEN   fine-grained PAT só deste repositório, com Actions: read and write
#   ALERT_GITHUB_REPO    dono/repositório (padrão: galaxie-works/galaxie-sports)
#
# Roteamento: severity=critical (os 5 sinais graves) e o Prometheus fora do ar vão para o push na hora e também
# entram no resumo; o resto (warning) só no resumo. Só push: o resumo sai no push, com prioridade baixa. Só e-mail:
# o crítico sai por e-mail na hora. A issue no GitHub corre por fora: todo alerta, crítico ou não, na hora. Nenhum
# canal: os alertas seguem visíveis no Grafana (Alerting) e no Prometheus.
set -eu
dir=/tmp/grafana-provisioning
src=/etc/grafana/alerting
rm -rf "$dir"
cp -R /etc/grafana/provisioning "$dir"

email=
push=
if [ -n "${ALERT_EMAIL_TO:-}" ] && [ -n "${ALERT_SMTP_HOST:-}" ]; then
  email='email-operacao'
  cp "$src/email.yml" "$dir/alerting/"
  export GF_SMTP_ENABLED=true
  export GF_SMTP_HOST="$ALERT_SMTP_HOST"
  export GF_SMTP_USER="${ALERT_SMTP_USER:-}"
  export GF_SMTP_PASSWORD="${ALERT_SMTP_PASSWORD:-}"
  export GF_SMTP_FROM_ADDRESS="${ALERT_EMAIL_FROM:-${ALERT_SMTP_USER:-}}"
  export GF_SMTP_FROM_NAME="${GF_SMTP_FROM_NAME:-Galaxie Sports alertas}"
  echo "alertas por e-mail ligados (SMTP $ALERT_SMTP_HOST): resumo diário"
fi
unset ALERT_SMTP_PASSWORD

if [ -n "${ALERT_NTFY_URL:-}" ]; then
  push='push-imediato'
  # template=grafana: o ntfy monta título e texto a partir do JSON do webhook (title/message abaixo)
  base="${ALERT_NTFY_URL%/}"
  export GALAXIE_NTFY_URGENT_URL="$base?template=grafana&priority=high&tags=rotating_light"
  export GALAXIE_NTFY_DIGEST_URL="$base?template=grafana&priority=low&tags=memo"
  auth=
  if [ -n "${ALERT_NTFY_TOKEN:-}" ]; then
    auth="
          authorization_scheme: Bearer
          authorization_credentials: \$ALERT_NTFY_TOKEN"
  fi
  receiver() {
    cat <<EOF
  - orgId: 1
    name: $1
    receivers:
      - uid: galaxie-$1
        type: webhook
        settings:
          url: \$$2
          httpMethod: POST
          maxAlerts: '10'
          title: '{{ template "galaxie.title" . }}'
          message: '{{ template "galaxie.text" . }}'$auth
EOF
  }
  {
    echo 'apiVersion: 1'
    echo 'contactPoints:'
    receiver push-imediato GALAXIE_NTFY_URGENT_URL
    receiver push-resumo GALAXIE_NTFY_DIGEST_URL
  } >"$dir/alerting/push.yml"
  echo "alertas por push ligados (ntfy): crítico na hora"
fi

github=
if [ -n "${ALERT_GITHUB_TOKEN:-}" ]; then
  github='issue-github'
  repo="${ALERT_GITHUB_REPO:-galaxie-works/galaxie-sports}"
  export GALAXIE_GITHUB_DISPATCH_URL="https://api.github.com/repos/$repo/actions/workflows/alerta-grafana.yml/dispatches"
  cp "$src/github.yml" "$dir/alerting/"
  echo "alertas no GitHub ligados ($repo): uma issue por alerta"
fi

if [ -n "$email$push$github" ]; then
  cp "$src/templates.yml" "$src/mute-timings.yml" "$dir/alerting/"
  # sem push nem e-mail, o que não casar com rota nenhuma cai na issue (na prática, a rota da issue pega tudo)
  root="${email:-${push:+push-resumo}}"
  {
    cat <<EOF
apiVersion: 1
policies:
  - orgId: 1
    receiver: ${root:-$github}
    group_by: ['grafana_folder', 'alertname']
    routes:
EOF
    if [ -n "$github" ]; then
      cat <<EOF
      # uma issue por alerta: agrupar por todos os rótulos põe um alerta só em cada envio. Sai na hora e de novo
      # quando resolve (o workflow fecha a issue); o repetido de 12 h só reabre se alguém fechou a issue antes
      - receiver: $github
        group_by: ['...']
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 12h
        continue: true
EOF
    fi
    if [ -n "$email$push" ]; then
      urgent="${push:-$email}"
      digest="${email:-push-resumo}"
      cat <<EOF
      # os 5 sinais graves (alerts.yml: severity=critical e o rótulo sinal), na hora; repete a cada 3 h
      - receiver: $urgent
        object_matchers:
          - ['severity', '=', 'critical']
        group_by: ['alertname', 'prometheus_alert']
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 3h
        continue: true
      # o alertador ficou cego (Prometheus fora do ar ou consulta da ponte falhando)
      - receiver: $urgent
        object_matchers:
          - ['alertname', '=~', 'DatasourceError|DatasourceNoData']
        group_wait: 1m
        group_interval: 5m
        repeat_interval: 3h
        continue: true
      # resumo: tudo o que está disparando, num envio só, uma vez por dia (janela em mute-timings.yml)
      - receiver: $digest
        group_by: ['grafana_folder']
        group_wait: 1m
        group_interval: 5m
        repeat_interval: 23h
        mute_time_intervals:
          - fora-do-resumo-diario
EOF
    fi
  } >"$dir/alerting/policies.yml"
else
  echo "alertas sem canal: defina ALERT_NTFY_URL (push), ALERT_EMAIL_TO e ALERT_SMTP_HOST (resumo por e-mail) e/ou ALERT_GITHUB_TOKEN (issue no GitHub); os alertas seguem visíveis no Grafana"
fi

export GF_PATHS_PROVISIONING="$dir"
exec /run.sh "$@"
