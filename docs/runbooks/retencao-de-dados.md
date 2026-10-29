# Retenção de dados (raw, change feed e tabelas de operação)

Regras em [docs/04 §1.1](../04-modelo-de-dados.md#11-retenção-dos-dados-que-crescem). Lote 6 da auditoria de produção de 28/10/2026.

## O que roda sozinho

| Job (scheduler do ingestor) | Horário (UTC) | O que faz |
|---|---|---|
| `change-feed-prune` | 02:45 | `ops.change_feed` com mais de 7 dias, respeitando a última mudança de cada entidade, o cursor dos webhooks e o piso do cache da demo |
| `data-retention` | 03:20 | raw do ao vivo com mais de 30 dias (fica a última resposta de cada requisição), ledger de IA com mais de 90 dias (agregado por dia antes), `job_run`, `quota_ledger`, `job_request`, `normalize_failure`, entregas de webhook |

Os dois apagam em lotes curtos (uma transação por lote, dentro do `statement_timeout` de 10 min do perfil `job`) e são idempotentes. O painel (Ajustes → Sistema) tem "rodar agora" para os dois.

A dedupe do raw é na gravação, sem job: corpo igual ao da última resposta da mesma requisição só atualiza `last_seen_at` e `seen_count`.

## Plano antes de apagar

```bash
docker compose run --rm --no-deps ingestor node dist/cli/data-retention.js --plan
```

```bash
docker compose run --rm --no-deps ingestor node dist/cli/change-feed-prune.js --plan
```

## Histórico do raw gravado antes da dedupe (uma vez, com OK do dono)

O `raw:compactar-historico` classifica como `live` o que veio dos jobs do ao vivo (`live:run`, `live:reconcile`, pelo `job_id` → `ops.job_run`) e junta as respostas repetidas em sequência numa linha só. Não roda no deploy. Rode antes de o `data-retention` apagar `ops.job_run` com mais de 90 dias, porque a classificação depende dele.

```bash
docker compose run --rm --no-deps ingestor node dist/cli/raw-history.js
```

```bash
docker compose run --rm --no-deps ingestor node dist/cli/raw-history.js --aplicar
```

Rodado de novo, o plano dá zero. Na produção, com a VPS sujeita a queda de SSH, rode com `setsid nohup ... > /root/logs/raw-history.log 2>&1 &`.

## Medição (cópia da produção, nunca a produção)

Dump diário da produção de 28/10/2026 20:26 UTC (`galaxie_sports_20261028T202643Z.dump`, sha256 conferido), restaurado no Postgres 17 de dev do NAS como `galaxie_probe_prod`. O raw da produção começou em 21/10, então ainda não há nada com mais de 30 dias.

**`raw.api_response` em 28/10:** 321 MB (282 MB de TOAST), 40 mil linhas, 7 dias.

| Origem | Linhas por dia | Corpos por dia | Repetidas (corpo igual ao anterior) |
|---|---|---|---|
| `live:run` (poll `fixtures?live=` e confirmação do encerrado) | ~3.300 | ~20 MB | 45% das linhas, 47 MB no total |
| `live:reconcile` (`fixtures?id=`) | ~2.700 | ~6 MB | 27% das linhas, 5,4 MB no total |
| sync diário, bootstrap | pouco | pouco | quase nada |

- **Sem este lote:** o ao vivo grava ~26 MB/dia de corpos comprimidos, ~9,5 GB por ano, sem teto.
- **Com a dedupe:** ~15 MB/dia.
- **Com a retenção de 30 dias:** o raw do ao vivo para em ~450 MB (30 dias × 15 MB, mais a última resposta de cada requisição: 22 MB na cópia). O resto (`keep`) cresce com o catálogo, não com o tempo.
- **Limpeza do histórico (`raw:compactar-historico --aplicar`) na cópia:** 33.915 linhas classificadas como `live`, 12.577 repetidas juntadas, 52,7 MB de corpos, **20 s**. Pequena: dá para rodar a qualquer hora, fora de jogo grande.
- **Poda do ao vivo na cópia** (simulada com `--dias-raw 2`): 17.127 linhas e 73,6 MB em 20 s, em lotes de 500.
- **O espaço apagado volta para a tabela, não para o disco:** o autovacuum marca o espaço como reaproveitável e o raw para de crescer. Devolver ao sistema de arquivos exigiria `VACUUM FULL` (trava a tabela inteira); não vale a pena para algumas centenas de MB.

**`ops.change_feed` em 28/10:** 141 MB, 163 mil linhas, ~30 mil e ~18 MB por dia. Até 28/10 a poda não tinha apagado nada (o feed começou em 21/10). Com 7 dias de retenção, o feed fica perto de 130 MB, mais a última mudança de cada entidade.

**Outras tabelas de operação em 28/10:** `ops.llm_usage` 10 MB, `ops.quota_ledger` 9 MB e `ops.job_run` 7 MB, todas com uma semana. Nenhuma linha passa das regras de 30 e 90 dias ainda: a poda começa a apagar no fim de novembro e no fim de janeiro.

## Índices novos (migration 0060, `CREATE INDEX CONCURRENTLY`)

A 0060 começa com `-- galaxie:concurrently`. O migrate (`packages/db/src/migrate.ts`) aplica as migrations anteriores, cria cada índice dela com CONCURRENTLY fora de transação (a escrita segue) e só então registra o arquivo, em que o `IF NOT EXISTS` não faz nada. Num banco vazio, como o do CI, o próprio arquivo cria os índices. Se um índice falha, o migrate para e a migration fica pendente. O índice inválido que sobrar é apagado e refeito na tentativa seguinte.

Na cópia da produção, as 0059 e 0060 levaram **18,9 s** no total. O maior índice foi `event_incident_participant_idx`, com 9,3 s em 2,7 milhões de linhas.

| Consulta (cópia da produção) | Antes | Depois |
|---|---|---|
| Jogos de uma temporada (`core.event.season_id`) | 1.390 ms (seq scan) | 1,2 ms |
| Jogos de uma fase (`core.event.stage_id`) | 139 ms (seq scan) | 0,2 ms |
| Estatísticas do elenco de um time (`person_season_stat.participant_id`) | 846 ms | 10 ms |

Também entram índices nas FKs `event_incident.participant_id` e `assist_person_id` (parcial, só não nulos), para apagar ou fundir time e pessoa sem varrer a maior tabela do core, e em `standing.participant_id`.

## Métricas e alertas

- `galaxie_db_database_bytes` e `galaxie_db_table_bytes{table}`: tamanho do banco e das 15 maiores tabelas, além das que a retenção poda. Leitura de catálogo, no máximo uma por minuto.
- `DiskFillingUp` (crítico, sinal `backup-disco`): no ritmo das últimas 12 h, o disco acaba em menos de 3 dias, e já tem menos da metade livre.
- `DatabaseGrowingFast` (aviso, resumo diário): o banco cresceu mais de 1 GiB em 24 h. Uma rodada de sincronização NAS → produção também dispara.
- O `DiskAlmostFull` (85%) continua como estava.
