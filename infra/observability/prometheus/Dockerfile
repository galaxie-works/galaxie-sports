# Prometheus com a configuração e as regras de alerta do Galaxie Sports embutidas (sem bind mounts no host).
#   docker build -t galaxie-sports-prometheus infra/observability/prometheus
FROM prom/prometheus:v3.15.1
COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY alerts.yml /etc/prometheus/rules/alerts.yml
COPY --chmod=0755 entrypoint.sh /etc/prometheus/entrypoint.sh
# Valida configuração e regras já no build.
RUN ["/bin/promtool", "check", "rules", "/etc/prometheus/rules/alerts.yml"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/bin/wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9090/-/ready"]
ENTRYPOINT ["/bin/sh", "/etc/prometheus/entrypoint.sh"]
CMD []
