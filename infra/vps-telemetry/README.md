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
| `mem_limit` por serviço (S3 1g, Grafana 512m: com 256m os dois chegam ao limite) | a VPS hospeda outras stacks |
| Serviço `demo` com login próprio (convites, papéis, prazo e atividade) | o app de demonstração (metadados em negociação) |
| Assets públicos: `GET/HEAD` do bucket via Traefik, bucket com leitura anônima só de objetos | logos, bandeiras e fotos na demo e na API |
| Grafana sem rota pública | acesso por túnel SSH |
| Serviço `agents`: imagem do ingestor com `SCHEDULER_PROFILE=agents` (resumo, cenário, Onde Assistir) e teto diário de tokens | IA ligada mesmo com o ingestor parado, com custo previsível |

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

**Sem credencial do GitHub na VPS** (alternativa): construir as imagens no commit mergeado em outra máquina, com os
mesmos nomes/tags, enviar com `docker save … | gzip | ssh root@<vps> 'gunzip | docker load'` e usar
`PULL_POLICY=missing` no `.env`.

## Atualizar (rotina: toda publicação passa por aqui)

```bash
infra/vps-telemetry/deploy.sh          # da máquina de desenvolvimento: constrói, envia, sobe, pós-deploy e smoke test
```

O script constrói `api`, `ingestor` e `demo` no commit (padrão `origin/main`), envia por `docker save | ssh docker load`,
atualiza `compose.yml` e `IMAGE_TAG` (com backup dos dois), sobe a stack mantendo a escala do ingestor e roda os
passos pós-deploy idempotentes (seed da base semântica, nomes curados de estádios, importância). Depois executa o
**smoke test** (`smoke.mjs`), que confere cada funcionalidade entregue **com dados**, não só o status 200: glossário, cores
e campanha do time, stakes e tags do torcedor, minuto a minuto, resumo da IA, conteúdo relacionado, emissoras, a busca global e a
proteção do login. `FAIL` (código, imagem ou config quebrados) sai com 1; `WARN` (dado incompleto: sync, cota, IA)
aparece no relatório. Para rodar só o smoke test:

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && docker compose exec -T demo node -' < infra/vps-telemetry/smoke.mjs
```

Os pacotes leem `config/` e `data/knowledge` a partir de si mesmos e **silenciam** quando não acham (lista vazia), então
um diretório fora da imagem não dá erro, só some a funcionalidade. Por isso as imagens levam `config/` inteiro (e a API a
base semântica), com `RULES_CONFIG_DIR`, `WTW_CONFIG_DIR`, `GEO_CONFIG_DIR`, `KNOWLEDGE_DIR` e `MEDIA_DENYLIST_PATH`, e o
CI confere os caminhos dentro das imagens de `api` e `ingestor` em todo PR.

## Deploy (primeira vez)

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

### Login da demo

O acesso é controlado pelo próprio app (Better Auth, tabelas no schema `demo_auth` do mesmo Postgres):

- `BETTER_AUTH_SECRET`: `openssl rand -hex 32`, gerado na VPS.
- Login sem senha: a pessoa informa o e-mail em `/login` e digita o código de 6 dígitos que chega por
  e-mail (vale 10 min, até 5 tentativas; novo pedido só depois de 1 min). E-mail sem convite recebe a
  mesma resposta, sem código. A sessão dura 30 dias e se renova com o uso.
- `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_NAME`: na primeira subida, sem nenhum admin, o app cria esse usuário e
  manda o convite (link para a tela de login).
- `SMTP_*`: remetente dos convites e dos códigos de acesso. Sem SMTP, o convite fica criado e o painel
  (`/ajustes/usuarios`) mostra o link para o admin copiar, mas ninguém consegue entrar: em produção o
  código nunca vai para o log (em desenvolvimento, sim).
- Convidados têm prazo de acesso; depois dele o login é bloqueado. Admin não expira.

## Verificação (de fora da VPS)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/health        # 200, certificado válido (sem -k)
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/metrics       # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/internal/x    # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$DEMO_DOMAIN/             # 307 → /login (sem sessão)
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
