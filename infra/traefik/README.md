# Traefik da VPS

O Traefik é a borda de **todas** as stacks da VPS (`galaxie-sports` e as outras em `/docker`): TLS do Let's Encrypt por
HTTP-01, redirecionamento 80 → 443 e roteamento pelos labels dos contêineres (`exposedbydefault=false`, então só entra
quem tem `traefik.enable=true`). Roda em `network_mode: host`; nenhuma stack publica porta.

[`compose.yml`](compose.yml) é o arquivo da VPS (`/docker/traefik/docker-compose.yml`), lido em 29/10/2026, com o
**access log** a mais. O `.env` de lá só tem `ACME_EMAIL` ([`env.example`](env.example)). Os certificados ficam no
volume `traefik_traefik-letsencrypt` (`acme.json`): não apague, senão todo domínio pede certificado de novo e o Let's
Encrypt limita a 5 por semana por conjunto de domínios.

## O que está aqui e o que está em outro lugar

| Peça | Onde |
|---|---|
| Configuração estática (entrypoints, ACME, provider Docker, access log) | este `compose.yml`, na VPS em `/docker/traefik` |
| Routers e serviços do Galaxie Sports | labels em [`infra/vps-telemetry/compose.yml`](../vps-telemetry/compose.yml) (`gsports-*`) |
| Compressão (gzip e br) e nova tentativa | middlewares `gsports-compress` e `gsports-retry`, por labels na stack do Galaxie Sports, ligados por `EDGE_MIDDLEWARES` no `.env` dela (abaixo) |
| Routers das outras stacks | nos composes delas, fora deste repositório (não mexer) |
| Firewall (`ufw`), SSH, Docker | [docs/runbooks/bootstrap-vps.md](../../docs/runbooks/bootstrap-vps.md) |

## Access log (precisa do OK do Wagner: reinicia a borda de todas as stacks)

JSON na saída do contêiner (`docker compose logs traefik`), girado em 5 × 20 MB. Leva status, duração, router, serviço,
host e IP do cliente. **Não leva o caminho** (`RequestPath`): ele inclui a query, e a query ainda pode trazer a chave do
SSE (`?key=`, aceita até 27/12/2026) e o token curto (`?token=`). Também não leva headers. Depois de 27/12/2026, sem a
chave na query, dá para voltar o caminho (o token dura 5 minutos); a decisão fica para lá.

Uso:

```bash
cd /docker/traefik
docker compose logs --since 1h traefik | grep '"RouterName":"gsports' | jq -r '"\(.DownstreamStatus) \(.Duration/1e6|floor)ms \(.RouterName)"' | sort | uniq -c | sort -rn | head
docker compose logs --since 1h traefik | jq -r 'select(.DownstreamStatus >= 500) | "\(.time) \(.DownstreamStatus) \(.RouterName)"'
```

### Aplicar

O `up -d` recria o contêiner: a borda fica fora por alguns segundos para todas as stacks (os certificados ficam no
volume). Fora de horário de jogo ao vivo.

```bash
cd /docker/traefik
cp docker-compose.yml docker-compose.yml.bak-$(date +%Y%m%d)
# copiar infra/traefik/compose.yml do repositório para docker-compose.yml (o .env fica como está)
docker compose config -q && docker compose up -d
```

### Conferir

```bash
docker compose ps                                    # Up
docker compose logs --since 2m traefik | grep -c RouterName   # > 0 depois de uma requisição
docker compose logs --since 2m traefik | grep -ciE 'key=|token='   # 0
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/health    # 200, certificado válido
```

E as outras stacks respondendo como antes (os hosts delas).

### Voltar

```bash
cd /docker/traefik && cp docker-compose.yml.bak-<data> docker-compose.yml && docker compose up -d
```

## Compressão (gzip e br)

Testada em 29/10/2026 com o Traefik v3.7.16 numa stack descartável no NAS: JSON sai com `Content-Encoding: br` (ou
`gzip` para quem só aceita gzip) e ~5% do tamanho; `text/event-stream` (o SSE) passa sem compressão; o label de
middlewares vazio deixa o router como está; o mesmo middleware declarado igual em vários contêineres não dá conflito.

O middleware `gsports-compress` é declarado por labels na `api`, na `demo`, no `s3` e na `maintenance` (igual nos
quatro: some só se os quatro caírem) e só comprime os tipos de texto da lista (`includedcontenttypes`). Fica fora: SSE,
imagens já comprimidas e qualquer resposta que já venha com `Content-Encoding` (a demo, o Next.js, já comprime parte).
Os routers `gsports-*` usam `middlewares=${EDGE_MIDDLEWARES:-}`: vazio (o padrão), nada muda.

Ligar (precisa do OK do Wagner; não reinicia o Traefik):

```bash
cd /docker/galaxie-sports
cp .env .env.bak-compress
echo 'EDGE_MIDDLEWARES=gsports-compress' >> .env
docker compose up -d api demo s3 maintenance      # recria os quatro (a demo e a API ficam ~30 s na página de manutenção)
curl -sS -o /dev/null -D - -H 'Accept-Encoding: br, gzip' "https://$API_DOMAIN/v1/sports" -H "x-galaxie-key: $KEY" | grep -i content-encoding   # br
curl -sS -N -m 5 -o /dev/null -D - -H 'Accept-Encoding: br, gzip' "https://$API_DOMAIN/v1/stream?token=$TOKEN" | grep -ci content-encoding   # 0
```

Voltar: tirar a linha do `.env` (ou `cp .env.bak-compress .env`) e o mesmo `docker compose up -d api demo s3 maintenance`.
O próximo deploy já usa o `.env` como estiver.

## Nova tentativa (`gsports-retry`)

Declarado do mesmo jeito (labels iguais nos quatro serviços, o CI confere): até 2 tentativas, a primeira depois de
100 ms, **só quando a conexão com o contêiner falha** (recusada ou caída antes de qualquer resposta); com resposta,
qualquer status, não tenta de novo. Serve à troca sem página de manutenção do deploy: o contêiner antigo da API ou da
demo para de aceitar conexão no SIGTERM, antes de o Traefik tirá-lo do balanceamento, e a requisição vai para o novo.
Ligar junto com a compressão: `EDGE_MIDDLEWARES=gsports-compress,gsports-retry` (mesmo `up -d` acima).
