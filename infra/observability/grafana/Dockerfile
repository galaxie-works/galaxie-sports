# Grafana com datasource (Prometheus), o painel de cota e a ponte dos alertas do Prometheus provisionados; os canais
# dos alertas (push pelo ntfy e resumo diário por e-mail) ligam pelo ambiente (entrypoint.sh).
#   docker build -t galaxie-sports-grafana infra/observability/grafana
FROM grafana/grafana:13.2.4
COPY provisioning/ /etc/grafana/provisioning/
COPY alerting/ /etc/grafana/alerting/
COPY dashboards/ /etc/grafana/dashboards/galaxie/
COPY --chmod=0755 entrypoint.sh /etc/grafana/galaxie-entrypoint.sh
ENV GF_AUTH_ANONYMOUS_ENABLED=false \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_ANALYTICS_REPORTING_ENABLED=false \
    GF_ANALYTICS_CHECK_FOR_UPDATES=false \
    GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false \
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/etc/grafana/dashboards/galaxie/galaxie-quota.json
ENTRYPOINT ["/etc/grafana/galaxie-entrypoint.sh"]
