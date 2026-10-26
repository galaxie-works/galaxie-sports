# Conferência das tabelas LATAM no raw de produção

As tabelas da temporada (Apertura, Clausura, zonas, anual, *promedios*) são reconhecidas pelo regulamento de cada competição (`tables:` e `knockout.seeding` em `config/rules/<slug>.yaml`, [docs/rules §1.4](../rules/README.md#14-tabelas-da-temporada-tables)): regex sobre o **nome do grupo** que a api-sports manda no `/standings` e sobre o **rótulo da rodada** (`league.round` do `/fixtures`, `core.stage.provider_label`). Parte desses nomes só foi vista no padrão da api-sports, sem amostra real (ver a tabela de cobertura no PR #364). Este runbook confere os nomes reais no raw de produção, só leitura, e diz o que fazer com o resultado.

Zero chamadas ao fornecedor: tudo sai do que já está em `raw.api_response` e `core`.

## Ids da api-sports

| Competição (slug) | id | Fonte do nome real |
|---|---|---|
| `argentina-liga-profesional` | 128 | Apertura/Clausura confirmados (captura da API); anual e promedios a conferir |
| `liga-mx` | 262 | a conferir |
| `uruguay-primera` · `uruguay-primera-clausura` | 268 · 270 | a conferir |
| `colombia-primera-a` | 239 | a conferir |
| `peru-liga-1` | 281 | a conferir |
| `paraguay-primera-apertura` · `paraguay-primera-clausura` | 250 · 252 | a conferir |
| `chile-primera-division` · `ecuador-ligapro-serie-a` · `bolivia-primera-division` · `venezuela-primera-division` | 265 · 242 · 344 · 299 | sem `tables` (formato a levantar) |

## 1. Nomes de grupo do `/standings` (por liga e temporada)

Cada resposta do `/standings` traz `response[0].league.standings`: uma lista de tabelas, cada uma uma lista de linhas com `group`. A consulta abaixo lista, da resposta mais recente bem-sucedida de cada liga × temporada, os grupos distintos, quantas linhas cada um tem e um time de exemplo:

```sql
-- só leitura; rode com o usuário de leitura (ou numa transação read only)
with latest as (
  select distinct on (params->>'league', params->>'season')
         params->>'league' as league, params->>'season' as season, fetched_at, body
    from raw.api_response
   where provider = 'api-sports' and sport = 'football' and endpoint = '/standings'
     and params->>'league' in ('128','262','268','270','239','281','250','252','265','242','344','299')
     and params->>'season' in ('2024','2025','2026')
     and status_code between 200 and 299
     and (errors is null or errors in ('[]'::jsonb, '{}'::jsonb))
   order by params->>'league', params->>'season', fetched_at desc
)
select l.league, l.season, l.fetched_at::date as coletado,
       t.ord as tabela,
       coalesce(t.tbl->0->>'group', '(null)') as grupo,
       jsonb_array_length(t.tbl) as linhas,
       t.tbl->0->'team'->>'name' as exemplo,
       t.tbl->0->>'description' as zona_do_primeiro
  from latest l
  cross join lateral jsonb_array_elements(l.body->'response'->0->'league'->'standings')
       with ordinality as t(tbl, ord)
 order by l.league::int, l.season, t.ord;
```

Grupo vazio no core (`core.standing.group = ''`) é o `group` nulo da api-sports: a coluna `grupo` mostra `(null)`. Para ver se mais de uma tabela vem com `group` nulo na mesma resposta (o que faria duas tabelas caírem na mesma chave), procure linhas repetidas de `(null)` para a mesma liga × temporada.

## 2. Rótulos de rodada

Do core (o que o normalizador gravou; uma linha por rótulo):

```sql
select c.slug, se.year, st.kind, st.provider_label, count(e.id) as jogos
  from core.stage st
  join core.season se on se.id = st.season_id
  join core.competition c on c.id = se.competition_id
  left join core.event e on e.stage_id = st.id
 where c.sport = 'football'
   and c.slug in ('argentina-liga-profesional','liga-mx','uruguay-primera','uruguay-primera-clausura',
                  'colombia-primera-a','peru-liga-1','paraguay-primera-apertura','paraguay-primera-clausura',
                  'conmebol-libertadores','conmebol-sudamericana','brasileirao-serie-a')
   and se.year between 2024 and 2026
 group by c.slug, se.year, st.kind, st.provider_label
 order by c.slug, se.year, min(st."order"), st.provider_label;
```

Se houver `/fixtures/rounds` no raw (lista de rótulos por liga × temporada):

```sql
select params->>'league' as league, params->>'season' as season, fetched_at::date,
       jsonb_array_elements_text(body->'response') as rodada
  from raw.api_response
 where provider = 'api-sports' and sport = 'football' and endpoint = '/fixtures/rounds'
   and params->>'league' in ('128','262','268','270','239','281','250','252')
 order by 1, 2, 3 desc;
```

## 3. O que o recálculo já reconhece (relatório)

Este passo **não** é só leitura: grava as tabelas calculadas, como o `sync:daily` faz todo dia. Para uma temporada só, use `--temporada <uuid>`; `--sem-publicar` não publica no change feed.

```bash
pnpm --filter @galaxie/ingestor standings:recompute --dias 30 --sem-publicar
```

Na coluna `detalhe`: `grupos sem tabela no regulamento: …` (o `groups` do YAML não casa), `rodadas de grupo fora do regulamento …` (o `rounds` não casa) e `skipped` (tabela que não deu para montar). As mesmas pendências saem em `warn` no `sync:daily` (`tabela recalculada com pendências`).

## 4. O que fazer com o resultado

| Achado | Ação |
|---|---|
| Nome de grupo confirma o regex do YAML | Marque "confirmado (raw de produção, data)" no comentário do YAML e na tabela de cobertura do PR/docs. |
| Nome diferente (ex.: `Liga MX: Apertura`, `Torneo Apertura`, `Apertura 2025`) | Ajuste `groups`/`exclude` da tabela em `config/rules/<slug>.yaml`, acrescente o nome real ao teste `packages/rules/src/standings/tables.test.ts` e rode `pnpm --filter @galaxie/rules test`. Não precisa de migration: o papel é calculado na leitura. |
| Tabela nova (ex.: `Promedios`, `Tabla Anual`, `Reclasificación`, quadrangulares) | Acrescente a entrada em `tables:` com o `kind` certo (`annual`, `relegation_average`, `other`). |
| Rótulo de rodada diferente (ex.: `Torneo Apertura - 3`, `Apertura - Quarter-finals` com outro nome) | Ajuste `rounds` (fase) ou `knockout.seeding` (Liguilla) e o teste. Rodada de mata-mata que o `parseRound` não reconheceu (fase `regular` com nome de mata-mata) também vai para `packages/providers/src/api-sports/football/round.ts`. |
| Mais de uma tabela com `group` nulo na mesma resposta | Elas colidem na mesma chave em `core.standing`: abra issue com a liga × temporada; a correção é no normalizador (`normalizeStandings`) e pede limpeza das chaves gravadas. |

Depois de ajustar: `pnpm --filter @galaxie/ingestor standings:recompute` nas temporadas afetadas (o recálculo regrava as tabelas e apaga o resíduo sem nome) e `standings:limpar-grupo-vazio` (prévia; `--aplicar` para apagar).
