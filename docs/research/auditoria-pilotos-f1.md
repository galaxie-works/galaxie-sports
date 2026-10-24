# Auditoria dos perfis de piloto da F1 (24/10/2026)

O dono do produto achou erros grosseiros no perfil do Hamilton. Esta auditoria confere **todos os 792 pilotos com ao
menos um GP largado** contra o F1DB (CC BY 4.0, a fonte da carreira). A prioridade é dos **64 pilotos** do grid de
2026, dos campeões e dos 20 primeiros em vitórias e em GPs.

São conferidos:

- a página `/pilotos/[slug]` da demo;
- o `GET /v1/teams/{id}/career`;
- o país do `GET /v1/teams/{id}`;
- a campanha do `GET /v1/teams/{id}/overview`.

Os pilotos da F1 são `core.participant`, por isso as rotas são as de `/v1/teams`.

Relatórios gerados pelo script, uma linha por problema:

- [producao-antes.md](auditoria-pilotos-f1/producao-antes.md): a produção hoje (código `0084176`, a `main`);
- [dev-depois.md](auditoria-pilotos-f1/dev-depois.md): a base de dev com o código deste PR e o F1DB reimportado.

## Como a auditoria funciona

O CLI `pnpm --filter @galaxie/api f1:auditoria` só lê. Ele roda em processo a mesma lógica que a API serve:

- `loadRaceCareer`;
- o país do participante;
- `loadTeamCompetitions`.

O resultado é comparado, campo a campo, com o SQLite do release fixado (`v2026.17.0`). A regra do heading (temporada
em destaque, cor e foto de fundo) é a da demo (`driver-hero.ts`), reproduzida em `apps/api/src/teams/f1-audit.ts`.

| Campo | Verdade |
|---|---|
| País e nascimento | `driver.nationality_country_id`, `date_of_birth`, `place_of_birth`, `country_of_birth_country_id`. O rótulo é o nome do país em pt-BR (`Intl.DisplayNames`), aceitando as grafias do cadastro curado (Holanda, República Tcheca) |
| Número permanente e da temporada | `permanent_number`; o mais usado nas corridas do ano |
| Títulos | 1º no `season_driver_standing` de temporada encerrada (2026 tem 6 GPs por correr) |
| GPs, vitórias, pódios, poles | `total_race_starts`, `total_race_wins`, `total_podiums`, `total_pole_positions` |
| Pontos | soma do campeonato por temporada, arredondada como no core |
| Melhor resultado, abandonos | `race_data` da corrida, uma linha por piloto e GP (`DNF`) |
| Equipe da temporada | o construtor com mais corridas largadas no ano (no empate, qualquer um deles) |
| Cor | a pintura curada da época (`liveries.yaml`) e texto branco a 4,5:1 sobre o fundo do heading |
| Campanha | com GP por correr, a temporada está em andamento |
| Retrato e fundo do heading | existem, a licença é livre e, no grid, o retrato é de 2025 ou 2026 (↗) |
| Nome | sobrenome do F1DB e, antes dele, o nome de uso (`name`: "Geoff", não "Geoffrey"), sem diferenciar maiúsculas e pontuação |

↗ marca o que é de outra frente e fica **só listado**:

- retrato mais recente, fotos do grid de 2026 e fallback do carro: sessão "Fotos da F1 para o grid atual";
- rótulo GB/Wales: mesma sessão;
- lacuna do `liveries.yaml`.

## Placar

Pilotos com o campo errado, todos os 792. Ao lado, os de outra frente (↗).

| Campo | Produção hoje | Dev antes¹ | Produção, só o deploy² | Dev depois³ |
|---|---:|---:|---:|---:|
| País e nacionalidade | 3 · ↗151 | 3 | 3 · ↗151 | 0 |
| Nascimento (data, local e país) | 3 · ↗155 | 3 | 3 · ↗155 | 0 |
| Número permanente | 0 | 0 | 0 | 0 |
| Número da temporada selecionada | 15 | 15 | 6 | 0 |
| Títulos mundiais (quantidade e anos) | 0 | 0 | 0 | 0 |
| GPs disputados | 238 | 244 | 3 | 0 |
| Vitórias | 4 | 7 | 4 | 0 |
| Pódios | 14 | 19 | 14 | 0 |
| Poles | 13 | 14 | 6 | 0 |
| Pontos | 0 | 0 | 0 | 0 |
| Melhor resultado (com contagem) | 14 | 18 | 14 | 1 |
| Abandonos | 32 | 41 | 25 | 0 |
| Equipe da temporada selecionada | 4 | 4 | 3 | 1 |
| Cor da equipe (curadoria e contraste) | 2 | 2 | 1 | 1 |
| Pintura da época sem curadoria | 0 · ↗376 | 0 · ↗367 | 0 · ↗380 | 0 · ↗371 |
| Campanha da temporada atual | 0 | 23 | 0 | 0 |
| Retrato | 0 · ↗748 | 0 · ↗760 | 0 · ↗748 | 0 · ↗760 |
| Fundo do heading | 0 · ↗737 | 0 · ↗697 | 0 · ↗737 | 0 · ↗700 |
| Nome (primeiro nome e sobrenome) | 1 | 1 | 0 | 0 |
| **Problemas no escopo (pilotos)** | **343** (267) | **394** (272) | **82** (43) | **3** (1) |

1. Base de dev antes das correções, medida às 20:40 UTC. O rótulo do GB já tinha sido corrigido no dev pela outra
   sessão: às 20:23 UTC eram 151 pilotos com "United-Kingdom".
2. O código deste PR contra a base da produção, em transação somente leitura, sem o reimport do F1DB: o que só o
   deploy corrige.
3. O código deste PR na base de dev, com o F1DB reimportado (`f1db:import --reprocessar`). É o que a produção deve
   mostrar depois do deploy e do reimport.

**Hamilton (o caso que abriu a auditoria):**

- **Produção:** 105 poles em vez de 104. A API contava o melhor tempo do quali; na Turquia 2021, Hamilton fez o melhor
  tempo e largou em 11º, com a punição pela troca de motor.
- **Dev:** 400 GPs em vez de 397, 209 pódios em vez de 208, 105 poles em vez de 104 e 32 abandonos em vez de 31. Além
  disso, a temporada de 2026 aparecia como "Terminou em 3º".
- **Depois:** tudo bate com o F1DB.

O "GB Wales" é o rótulo da linha `GB` em `core.country` da produção (151 pilotos britânicos). O retrato antigo e o
heading sem fundo são das fotos. Os três ficam com a outra sessão.

## Causas e correções (na origem)

| # | Erro | Causa | Correção | Onde |
|---|---|---|---|---|
| 1 | GPs a mais (238 pilotos na produção) | "Não largou" (`DNS`), "não participou" (`DNP`) e "excluído" (`EX`) contavam como GP disputado. Na api-sports, o DNS vem sem posição, sem tempo e com 0 volta (Stroll, Albon e Gasly em 2024) | Só conta o GP largado, como no F1DB | `apps/api/src/teams/career.ts` (`started`) |
| 2 | Poles erradas (Verstappen 54 × 50, Leclerc 25 × 27) | A API dava a pole ao 1º da classificação; a do F1DB é de quem larga nela, com a punição de grid descontada (Spa 2024 é do Leclerc) | O normalizador grava `result.pole` (`race_pole_position`) e a carreira conta por ela. Sem a marca (api-sports), vale o grid 1; nas sprints de 2022, o 1º do quali (Magnussen, Brasil 2022) | `packages/providers/src/f1db/normalize.ts`, `career.ts` |
| 3 | Abandonos a mais | A api-sports põe `time: "DNF"` também em quem foi classificado com 90% das voltas (Russell, 17º em Melbourne 2024). O F1DB classifica pelo `position_text` mesmo com `time: "DNF"` (Hamilton, 18º em Abu Dhabi 2022) | Classificado = posição numérica no F1DB; na api-sports, 90% das voltas do líder, arredondado para baixo | `career.ts` (`classifiedAt`, `retired`) |
| 4 | Vitórias, pódios e poles a menos nos anos 1950 (Fangio 22 × 24, Moss 15 × 16) | Carro compartilhado: o piloto aparece duas vezes na mesma corrida, e o upsert ficava com a última linha (o abandono no carro dele, não a vitória no do colega) | Uma linha por piloto na sessão, a melhor, com a pole de qualquer uma delas | `normalize.ts` |
| 5 | Leclerc, Chiron e Beretta sem país | Mônaco não é membro da FIFA, e o `core.country` só tinha os países dos catálogos. Sem a linha, o upsert descartava o código | O import do F1DB cria os países que faltam, com nome em en, pt-BR e es (`Intl.DisplayNames`); nome curado nunca é trocado | `f1dbCountries`, `services/ingestor/src/f1db/import.ts` |
| 6 | Corridas e poles em dobro em 2022 e 2023 (dev) | A api-sports de 2022/2023 chegou depois do F1DB, e o casamento de sessões aceitava ±3 h. Antes de 2024 o F1DB só estima o horário (Bahrein 2022: 11h estimado, 15h real). Além disso, a classificação inteira do F1DB convivia com o `3rd Qualifying` da api-sports | Casamento pelo dia (±18 h) quando o horário gravado é estimado. A carreira usa uma linha por piloto em cada sessão de cada GP, a do F1DB primeiro | `services/ingestor/src/normalize/upsert-core.ts` (`matchRaceSessions`), `career.ts` (`onePerSession`) |
| 7 | 2026 como "Terminou em 3º" ou "Campeão" (Antonelli) | A campanha só via GP por disputar entre os eventos da base; o F1DB não cria GP futuro | A temporada com `end_date` por vir está em andamento (é o que o F1DB grava: o último GP do calendário) | `apps/api/src/teams/load-campaigns.ts` |
| 8 | "Carlos Sainz \| Jr" | O nome da api-sports vem sem o ponto ("Carlos Sainz Jr") e o sobrenome do F1DB com ele ("Sainz Jr.") | O sobrenome fecha o nome sem diferenciar a pontuação. "Nyck de Vries" continua com a grafia do nome | `career.ts` (`splitName`) |
| 9 | Número da época errado (15 lendas) | O número mais usado contava treinos e classificações | Vale o das corridas; sem corrida, as demais sessões | `career.ts` |

Na produção, o deploy sozinho resolve 1, 3 (api-sports), 6, 7, 8 e 9. As causas 2, 4 e 5 precisam do reimport do
F1DB com `--reprocessar` (ver os comandos).

Os casos difíceis de nome conferem: "Kimi \| Antonelli", "Carlos \| Sainz Jr.", "Nyck \| de Vries" e
"Guanyu \| Zhou". No core, o nome é "Guanyu Zhou", não "Zhou Guanyu".

## O que fica de fora

### Resíduo no escopo: 1 piloto

**Guanyu Zhou, 2024.** A api-sports divide a Sauber de 2024 em dois IDs: "Sauber F1 Team" e "Stake F1 Team Kick
Sauber". O primeiro casou com o `sauber` do F1DB (1993–2018), não com o `kick-sauber`. Por isso o heading de 2024 fica
sem a pintura curada, e um 8º lugar (Catar 2024) falta na contagem.

A correção é juntar os dois IDs da api-sports numa entidade só. É um trabalho de fusão de participantes, que vai com o
item abaixo.

### Para outra frente ou um próximo PR

- **Pilotos duplicados no dev (não na produção):** Sebastian Vettel, Mick Schumacher, Nicholas Latifi e Nyck de
  Vries têm duas entidades cada. Uma é do F1DB, completa; a outra é da api-sports de 2022/2023, carregada depois do
  F1DB. A página auditada (a do F1DB) está certa, mas a busca mostra dois.
  A correção é fundir as entidades: `event_participant`, `provider_map`, `standing` e fotos.
- **Sessões duplicadas no dev (não na produção):**
  - corridas sem vínculo: 2022 com 3 do F1DB e 4 da api-sports; 2023 com 5 do F1DB e 7 da api-sports;
  - 1 sprint em 2023;
  - a classificação inteira do F1DB ao lado do `3rd Qualifying`.

  A carreira já não conta em dobro, e o casamento novo evita duplicatas em cargas futuras. As que existem continuam
  no core e aparecem na lista de corridas da temporada. **Não sincronize a F1 de 2022/2023 do NAS para a produção**
  antes de limpar isso.
- **Fundo do heading em 3 lendas** (Lance Reventlow, Paddy Driver e Peter Arundell): a temporada em destaque deixou
  de ser uma em que eles não largaram. Com isso, o carro de destaque não vale mais, e eles ficam sem foto. É o fallback
  do carro: fica com a sessão de fotos.
- **↗ Fotos** (retrato mais recente, grid de 2026, fallback do carro) e **↗ rótulo GB/Wales**: sessão "Fotos da F1
  para o grid atual".
- **↗ Pintura sem curadoria:** em 371 pilotos, a época da equipe em destaque não está no `liveries.yaml`. É curadoria
  com fonte e revisão, não erro de código; o heading usa a cor do escudo ou o cinza neutro. Entre os 64 prioritários,
  nenhum.

## Comandos de produção

Depois do merge e do deploy normal da `main` (API e ingestor), na VPS:

```bash
ssh root@145.223.94.149
cd /docker/galaxie-sports
# 1. backup
docker compose exec -T backup backup.sh
# 2. prévia do reimport do mesmo release (desfaz no fim); o pico no dev foi de 498 MB, então com o override
printf 'services:\n  ingestor:\n    mem_limit: 3g\n' > /tmp/f1db-mem.yml
docker compose -f compose.yml -f /tmp/f1db-mem.yml run --rm --no-deps -v galaxie-f1db:/data/f1db \
  -e F1DB_DIR=/data/f1db -e NODE_OPTIONS=--max-old-space-size=2560 ingestor \
  node dist/cli/f1db-import.js --reprocessar --previa
#    esperado: "países criados: MC", "eventos inseridos: 0", milhares de "eventos atualizados"
# 3. grava
docker compose -f compose.yml -f /tmp/f1db-mem.yml run --rm --no-deps -v galaxie-f1db:/data/f1db \
  -e F1DB_DIR=/data/f1db -e NODE_OPTIONS=--max-old-space-size=2560 ingestor \
  node dist/cli/f1db-import.js --reprocessar
# 4. cache de respostas
for p in 'gs:cache:*' 'gs:tag:*'; do docker compose exec -T valkey sh -c "valkey-cli --scan --pattern '$p' | xargs -r -n 200 valkey-cli del >/dev/null"; done
# 5. auditoria (só leitura) com o ambiente da API; o relatório sai na saída padrão
docker compose run --rm --no-deps -T -v galaxie-f1db:/data/f1db api \
  node dist/cli/f1-auditoria.js --f1db /data/f1db/v2026.17.0/f1db.db --ambiente "produção, depois" > /root/auditoria-pilotos-f1.md
head -40 /root/auditoria-pilotos-f1.md
```

Esperado no passo 5: o placar da coluna "Dev depois", exceto ↗.

- O "País" continua com 151 ↗ até a sessão de fotos corrigir o rótulo do GB.
- O retrato e o fundo ↗ dependem do acervo da produção.

**Reverter:** restaurar o backup do passo 1. O código volta com o deploy anterior.

## Rodar a auditoria

```bash
pnpm --filter @galaxie/api build
pnpm --filter @galaxie/api f1:auditoria --out relatorio.md --json placar.json   # release em F1DB_DIR ou ~/.galaxie/f1db
pnpm --filter @galaxie/api f1:auditoria --pilotos lewis-hamilton,carlos-sainz-jr  # só esses (IDs do F1DB)
pnpm --filter @galaxie/api f1:auditoria --completo   # as outras frentes de todos, não só dos prioritários
```

Defina `ASSETS_PUBLIC_BASE_URL` como na API: sem ela, a carreira descarta as fotos, e retrato e fundo aparecem
vazios.
