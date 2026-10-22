# Staging na VPS "telemetry" (Traefik)

Stack em [`compose.yml`](compose.yml), derivada de [`infra/portainer/stack.yml`](../portainer/stack.yml) para uma VPS que
**já tem Traefik v3 em produção** (`network_mode: host`, provider Docker com `exposedByDefault=false`,
entrypoints `web`/`websecure`, certresolver `letsencrypt` por HTTP-01).

| Diferença para a stack do Portainer | Por quê |
|---|---|
| Sem Caddy; labels do Traefik na `api`, na `demo` e no `s3` | o Traefik da VPS faz TLS e roteamento |
| `/metrics` e `/internal` fora do router da API | mesmo bloqueio que o Caddy fazia |
| Sem `build:`; `pull_policy: always` com imagens do GHCR | não compilar o monorepo na VPS (2 vCPU compartilhadas) |
| Sub-rede fixa `172.30.50.0/24` e `TRUST_PROXY=172.30.50.1` | o Traefik chega aos contêineres pelo gateway da rede |
| `mem_limit` por serviço | a VPS hospeda outras stacks |
| Serviço `demo` com basic auth | o app de demonstração (metadados em negociação) |
| Assets públicos: `GET/HEAD` do bucket via Traefik, bucket com leitura anônima só de objetos | logos, bandeiras e fotos na demo e na API |
| Grafana sem rota pública | acesso por túnel SSH |

Domínios (registro A → IP da VPS): `DEMO_DOMAIN` (demo), `API_DOMAIN` (API pública) e `ASSETS_DOMAIN` (assets).
**O DNS precisa resolver antes de subir**, senão o desafio HTTP-01 do Let's Encrypt falha.

## Regras da VPS

- Não tocar nas outras stacks em `/docker/` (nada de editar, parar, `down` ou `pull` nelas).
- Proibido: `docker system prune`, `docker volume prune`, `docker network prune`, mexer no `ufw`, publicar portas.
- Segredos só no `.env` da VPS (`chmod 600`), gerados lá com `openssl rand -hex 32`; nunca impressos.
- **Uma chave, um ingestor**: com o ingestor da VPS no ar, nenhum outro ambiente roda jobs com a mesma
  `APISPORTS_KEY` (a cota diária é por conta e por API).

## Imagens

O workflow [`docker.yml`](../../.github/workflows/docker.yml) publica no push para a `main`
`ghcr.io/galaxie-works/galaxie-sports-<imagem>:<sha>` e `:staging` para `api`, `ingestor`, `demo`, `backup`,
`prometheus` e `grafana` (o `caddy` não é publicado). Use o **SHA do commit** em `IMAGE_TAG`.
Com pacotes privados, a VPS precisa de `docker login ghcr.io` com um token só `read:packages`.

## Deploy

```bash
mkdir -p /docker/galaxie-sports && cd /docker/galaxie-sports
# compose.yml deste diretório, no commit mergeado; .env a partir de env.example (chmod 600)
docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'  # 172.30.50.0/24 livre?
docker compose pull
docker compose up -d
docker compose ps        # migrate e s3-init: Exited (0); demais: Up/healthy
```

### Dados iniciais (sem gastar cota de novo)

O banco local já tem o bootstrap (raw + core). Em vez de refazer as chamadas:

1. **Banco**: `pg_dump -Fc` do Postgres local → copiar para a VPS → com a stack no ar mas **ingestor parado**
   (`docker compose stop ingestor`), `pg_restore --clean --if-exists --no-owner` dentro do contêiner `postgres`.
2. **Assets**: sincronizar o bucket local com o da VPS (`aws s3 sync` por túnel SSH até o `s3` da stack).
3. Subir o ingestor de novo (`docker compose start ingestor`) e **parar qualquer ingestor local**.

### Tenant da demo

```bash
docker compose exec api node dist/cli/tenant-create.js --slug demo --name Demo --plan enterprise --daily-quota none --label demo-vps
# copiar a chave exibida para GALAXIE_DEMO_KEY no .env (sem colar em chat/log) e recriar só a demo:
docker compose up -d demo
```

Para o basic auth da demo: `htpasswd -nbB <usuário> '<senha>'` e o resultado **entre aspas simples** em
`DEMO_BASIC_AUTH` (o hash tem `$`).

## Verificação (de fora da VPS)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/health        # 200, certificado válido (sem -k)
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/metrics       # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/internal/x    # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$DEMO_DOMAIN/             # 401 sem usuário e senha
curl -sS -o /dev/null -w '%{http_code}\n' https://$ASSETS_DOMAIN/$S3_BUCKET/api-sports/flags/br.svg   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://$ASSETS_DOMAIN/$S3_BUCKET/                          # 403/404 (sem listagem)
```

- Backup inicial: `docker compose exec backup ls -la /backups`.
- Grafana: `ssh -L 3000:<IP do contêiner grafana>:3000 root@<vps>` e abrir `http://localhost:3000`.
- As outras stacks continuam respondendo como antes.

## Reverso

- Parar e remover: `cd /docker/galaxie-sports && docker compose down` (**sem `-v`**: os dados ficam).
- Apagar os dados (Postgres, S3, backups) só com pedido explícito: `docker compose down -v`.
- Remover os registros DNS. Nada disto toca nas outras stacks.

## Pendências

- Backups no mesmo disco: ligar a cópia para um S3 externo (`BACKUP_S3_*`) quando houver bucket.
- Cabeçalhos de cache/CDN para os assets.
