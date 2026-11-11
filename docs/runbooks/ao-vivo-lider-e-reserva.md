# Ao vivo: líder e reserva

O placar ao vivo roda no serviço `live` da stack ([README da stack › Ao vivo](../../infra/vps-telemetry/README.md#ao-vivo-serviço-live)),
em duas cópias. Cada cópia tem um `live-run` no ar, e só a que segura a trava `live:leader` (advisory lock de sessão no
Postgres) chama a api-sports. A outra é a reserva e tenta a trava a cada 1 s (`LIVE_LEADER_RETRY_MS`). Se a líder cai,
a reserva assume na tentativa seguinte. O desenho está em [services/ingestor › Ao vivo](../../services/ingestor/README.md#ao-vivo-líder-e-reserva).

Comandos na VPS, em `/docker/galaxie-sports`. O hostname de cada cópia é o ID curto do contêiner (12 caracteres), e é ele que
aparece como `instance` nos logs, no `live_leader` e na sessão `galaxie-live-leader:<hostname>` do Postgres.

## Quem é a líder

Pelo Postgres (a fonte da verdade):

```bash
docker compose -f compose.dados.yml exec -T postgres sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select a.application_name, a.backend_start::timestamp(0), l.pid is not null as lider
  from pg_stat_activity a
  left join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
 where a.application_name like 'galaxie-live-leader:%';
select cursor->>'instance' as mandato_de, cursor->>'epoch' as epoca, updated_at::timestamp(0) as desde
  from ops.sync_cursor where endpoint = 'live:leader_epoch';
SQL
docker ps --filter label=com.docker.compose.service=live --format '{{.ID}} {{.Names}} {{.Status}}'
```

Também dá para ver:

- no painel, em Ajustes → Plataforma → Status dos serviços, cartão dos serviços, linha Ao vivo (a líder do mandato atual e o último tick);
- no `/metrics` de qualquer cópia (a série vem do Postgres, igual nas duas):
  `docker compose exec live node -e "fetch('http://127.0.0.1:9464/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('live_')).join('\n')))"`
  (`live_leader{instance="<hostname>"} 1` é a líder);
- nos logs: `docker compose logs --since 30m live | grep -E 'liderança|live_leader'`.

## Forçar a troca de líder

Sem reiniciar nada: derrube a sessão da trava da líder. A cópia percebe a perda, descarta o tick em andamento e volta
para a espera, e a reserva assume em até 1 s:

```bash
docker compose -f compose.dados.yml exec -T postgres sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select pg_terminate_backend(a.pid)
  from pg_stat_activity a join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
 where a.application_name like 'galaxie-live-leader:%';
SQL
```

Reiniciando a cópia líder: com `docker restart -t 75 <id>` a líder fecha o tick, solta a trava e volta como reserva.

**Ensaio de queda** (`docker kill`, sem aviso): `docker kill <id da líder>`. O Postgres fecha a sessão, a trava some e a
reserva assume na tentativa seguinte. O `docker kill` conta como parada manual, então o contêiner morto pode ficar
parado; para voltar às duas cópias: `docker compose up -d --no-deps live`.

Depois de qualquer um dos três, confira a líder nova (acima) e no Grafana, painel "SLOs e orçamento de erro", linha
"Ritmo do ao vivo": `live_tick_interval_max_seconds` deve ficar abaixo de 15 s com jogo em andamento.

## Uma cópia só (dev, ou para economizar memória)

No `.env`: `LIVE_REPLICAS=1`, e `docker compose up -d --no-deps live` (o Compose para a cópia a mais). Sem reserva,
a queda da líder para o ao vivo até o scheduler subir o `live-run` de novo (1 s depois de o processo sair, ou o contêiner
inteiro pelo healthcheck), e o deploy troca a única cópia ao lado de uma nova, como antes. Para voltar a duas: tire a
variável (o padrão é 2) e o mesmo `up`. No NAS de dev o ao vivo nem tem serviço próprio: roda dentro do ingestor
(`SCHEDULER_LIVE=internal`).

## Deploy com jogo em andamento

O `deploy-gh.sh` troca o `live` cópia a cópia, a líder primeiro ([`rolling-swap.sh`](../../infra/vps-telemetry/rolling-swap.sh)).
No log do deploy:

```text
live: 2 cópia(s); líder 3f2a1b9c0d4e (troca primeiro)
ok  live: liderança passou de 3f2a1b9c0d4e para 7c6d5e4f3a2b em 2 s (a antiga levou 1 s para fechar o tick e sair)
ok  live: cópia 3f2a1b9c0d4e trocada por 9a8b7c6d5e4f
...
ok  live trocado cópia a cópia (2 no ar)
```

Sem nenhuma cópia assumindo a liderança em 60 s depois de a antiga sair (`SWAP_LEADER_TIMEOUT`), a troca sai com `FAIL` e o deploy volta o grupo
`live ingestor agents` para a versão anterior. Para olhar o efeito no placar: `live_last_tick_age_seconds`,
`live_tick_interval_max_seconds` (abaixo de 15 s) e `live_leader` no Prometheus; o alerta `LiveTickGap` dispara se o ritmo
parar por mais de 1 min.
