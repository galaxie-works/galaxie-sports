# infra

Tudo o que sobe o Galaxie Sports fora do código: a infra local de desenvolvimento, a stack da VPS, backup,
observabilidade e os scripts de operação.

| Pasta / arquivo | O que é | Onde roda |
|---|---|---|
| [`docker-compose.yml`](docker-compose.yml) | Infra **local**: Postgres 17 (porta 5433), Valkey, RustFS/S3 + bucket, e o k6 (perfil `load`) | máquina de dev (`pnpm infra:up`) |
| [`vps-telemetry/`](vps-telemetry/README.md) | **A stack da VPS**: Traefik na borda, imagens do GHCR, `api`, `demo`, `ingestor`, `agents`, `webhooks`, `lineup-render`, backup, Prometheus e Grafana, página de manutenção, scripts do deploy (`deploy-gh.sh`, `live-hold.sh`) | VPS (o nome é o da máquina) |
| [`traefik/`](traefik/README.md) | Cópia do Traefik da VPS, que serve todas as stacks de lá | VPS |
| [`ops/`](ops/README.md) | Plano B de operação a partir da máquina de dev (deploy, trem de merge, portão do Codex, issue de alerta) | dev (Git Bash) |
| [`backup/`](backup/README.md) | Imagem do backup diário do Postgres (dump validado, retenção, S3 opcional, ensaio de restauração) | VPS (`backup`) |
| `nas-backup/` | Cópia dos dumps da VPS para o NAS (camada 2 do 3-2-1) | NAS |
| `observability/` | Imagens do Prometheus (alertas, SLOs, testes de regra) e do Grafana (painéis de cota e SLO, alertas → issues) | VPS |
| `caddy/` | Imagem do Caddy da antiga stack do Portainer, sem uso. Fica só enquanto `build caddy` for check obrigatório da `main`; sai quando o check for retirado | nenhum |
| `lineup-render/` | Servidor do Playwright para renderizar páginas de grade com JavaScript. Fora do workspace pnpm (tem `package-lock.json` próprio) | VPS (`lineup-render`) |
| `healthcheck/selfheal.mjs` | Healthcheck com auto-reinício, copiado nas imagens Node (API, demo, ingestor) | dentro das imagens |

## Fluxo do deploy

1. O merge no `main` dispara `.github/workflows/docker.yml`, que constrói e publica as imagens no GHCR com a tag do SHA.
2. `.github/workflows/deploy.yml` entra por SSH na VPS e roda `vps-telemetry/deploy-gh.sh`: trava, pull, `migrate`,
   candidatas, troca, smoke test e volta ao SHA anterior se algo falhar. Com jogo importante ao vivo, espera
   (`live-hold.sh`).

Passo a passo: [docs/runbooks/deploy-pelo-github.md](../docs/runbooks/deploy-pelo-github.md) · Subir uma VPS do zero:
[docs/runbooks/bootstrap-vps.md](../docs/runbooks/bootstrap-vps.md) · Backup e DR:
[docs/runbooks/exercicio-dr.md](../docs/runbooks/exercicio-dr.md) · Alertas:
[docs/runbooks/alertas-e-monitoramento.md](../docs/runbooks/alertas-e-monitoramento.md).

## Stack única

A stack do Portainer (Caddy com TLS e `build:` local) foi a primeira staging e foi aposentada em 30/10/2026. O que ela
documentava de backup e restore está em [backup/README.md](backup/README.md); o resto vale pela `vps-telemetry`.
