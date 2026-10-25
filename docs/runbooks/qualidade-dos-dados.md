# Qualidade dos dados (regras automáticas, job diário e placar)

Em 24/10/2026, o dono do produto achou erros grosseiros só olhando a demo:

- o Fangio de 1958 aparecia como "Mercedes-AMG Petronas";
- o Hamilton aparecia com "GB Wales";
- o Wikidata trazia campeões errados e times ligados aos femininos;
- a grade de planos tinha canais atribuídos ao plano errado.

A partir daí, a auditoria virou rotina para que os erros não dependam mais de alguém achar. Cada regra compara o que a API entrega, ou o que está no core, com uma referência:

- F1DB;
- Wikidata;
- a tabela do fornecedor;
- o dicionário de emissoras.

O job `data-quality` roda todo dia às 04:40 UTC e grava o placar em `ops.quality_*`. O painel mostra o placar em **Ajustes → Operação → Qualidade dos dados**:

- por esporte e por regra: ok, falhas e tendência das últimas 14 execuções;
- a lista das falhas, com link para a página ou o item e a data em que cada uma apareceu.

**Regra de ouro:** todo erro achado à mão vira uma regra, com `origin` dizendo quem achou e quando. Se o erro voltar, o placar acusa antes do cliente.

## Rodar

```bash
pnpm --filter @galaxie/ingestor quality:run --plan
```

O `--plan` é a prévia: roda tudo, mostra o placar e **não grava**. Opções:

| Opção | O que faz |
|---|---|
| `--plan` | Prévia: não grava em `ops`. |
| `--regras f1.,geo.ambiguous-country-code` | Só estas regras. Um id termina a regra; um prefixo terminado em `.` pega a área. |
| `--esporte formula-1` | Só as regras do esporte (e as de todos os esportes). |
| `--md falhas.md` | Relatório em markdown (placar e até 20 falhas por regra e esporte), para anexar num PR ou nota. |
| `--json placar.json` | Resultado completo em JSON. |
| `--agendado` | Marca a execução como do agendador (o job usa). |

Sem `--plan`, grava a execução e aplica a retenção: as falhas ficam 30 dias; o placar e a tendência, 180. O painel também tem o botão **Rodar agora**, que entra na fila do scheduler do ingestor.

### Fontes externas

| Fonte | Quem usa | Configuração | Sem ela |
|---|---|---|---|
| API pública | regras `f1.*` (menos `f1.driver-link`) | `QUALITY_API_URL` e `QUALITY_API_KEY`. No dev, caem em `NEXT_PUBLIC_GALAXIE_API_URL` e `GALAXIE_DEMO_KEY` do `.env`. | `skipped` |
| F1DB (release fixado) | regras `f1.*` | `F1DB_DIR` (padrão `~/.galaxie/f1db`). Baixa o zip na primeira vez e confere o sha256. | `skipped` |
| Wikidata (`wbgetentities`) | `wikidata.team-category` | nenhuma: 50 QIDs por pedido, 1 pedido/s | `error` |

Regra sem a fonte sai como **`skipped`**, com o motivo, e nunca como `pass`. Nenhuma regra gasta cota da api-sports.

No VPS, a API do próprio stack serve de alvo: `QUALITY_API_URL=http://api:8080`, com uma chave de tenant interno só para leitura.

## Severidade e status

- **Severidade:**
  - `critical`: erro que o cliente vê na página (equipe errada, país errado, placar ausente);
  - `high`: dado errado, mas menos visível (escudo faltando, preço sem moeda);
  - `medium`: cadastro implausível (idade);
  - `low`: cosmético.
- **Status:**
  - `pass`: nenhum item errado;
  - `fail`: ao menos um item errado;
  - `skipped`: faltou a fonte;
  - `error`: a consulta quebrou. As outras regras rodam mesmo assim, mas o job sai com código 1 e aparece como falha em `ops.job_run`.

## Regras atuais

| Regra | Esporte | O que garante | Referência |
|---|---|---|---|
| `f1.driver-link` | F1 | Todo piloto prioritário (grid atual, campeões, 20 primeiros em vitórias e em GPs) tem participante no core com vínculo `f1db`. Sem ele, as outras regras da F1 não conferem o piloto. | F1DB + `core.provider_map` |
| `f1.season-team` | F1 | A equipe de cada temporada do piloto é o construtor daquele ano, com o **nome da época**. Em 1955, "Mercedes-AMG Petronas" é erro; em 2024, não. | F1DB `race_data` + `season_entrant_driver`/`entrant` |
| `f1.season-number` | F1 | O número da temporada é um dos mais usados nas corridas do ano. | F1DB `race_data.driver_number` |
| `f1.career-totals` | F1 | Títulos (quantidade e anos), vitórias e GPs largados. | F1DB |
| `f1.driver-country` | F1 | O país é o da nacionalidade. GB é o Reino Unido, nunca Gales. | F1DB `driver.nationality_country_id` |
| `geo.ambiguous-country-code` | — | GB e UA têm o nome do país inteiro nos três idiomas. | `AMBIGUOUS_COUNTRIES` |
| `events.finished-has-score` | todos | Jogo encerrado tem placar dos dois lados. | — |
| `events.no-stale-live` | todos | Jogo com fim previsto há mais de 3 h não fica `starting`/`live`/`break`. | — |
| `standings.recomputed-matches-provider` | futebol | A tabela recalculada pelo motor (`@galaxie/rules`) bate com a do fornecedor, nos tier 1 da temporada atual. Só compara time com o mesmo número de jogos. | `core.standing` `source = provider` |
| `assets.tier1-team-logo` | todos | Todo time de competição tier 1 na temporada atual tem escudo. | — |
| `people.plausible-birth-date` | todos | Jogador de elenco atual não nasceu no futuro nem tem mais de 60 anos. Técnico não entra. | — |
| `wikidata.team-category` | todos | O QID ligado ao time é da mesma categoria: principal, feminino, base ou reserva. | Wikidata (rótulo e descrição) |
| `titles.safe-link-only` | futebol | Título só conta para o time ligado ao QID do vencedor no `provider_map`, ou corrigido na curadoria. | `core.competition_title` |
| `titles.winner-category` | futebol | Título de competição principal vai para time principal; de competição feminina, para time feminino. | nome da competição e do time |
| `watch.included-has-official-source` | grades | Item servido como incluso tem fonte oficial: página no site da operadora ou do plano, ou informado pela operadora. | `enrich.plan_channel`/`plan_service` |
| `watch.plan-price-currency` | grades | Plano servido tem preço com moeda. | `enrich.platform_plan.price_text` |
| `watch.channel-in-dictionary` | todos | Onde assistir publicado (últimos 30 dias) usa emissora e canal do dicionário. | `config/broadcasters` → `enrich.broadcaster` |

"Servido" segue o piso editorial `LINEUP_MIN_REVIEW_STATUS` (padrão `approved`) e a vigência do plano (`valid_from`/`valid_to` no dia da execução), os mesmos filtros da API.

## Como adicionar uma regra

1. **Escolha a área e o id.** O arquivo é `services/ingestor/src/quality/rules/<área>.ts` (`f1`, `events`, `standings`, `catalog`, `wikidata`, `watch` ou `geo`). O id é `<área>.<o-que-garante>`, em minúsculas com hífen, e não muda depois: é a chave do placar e da tendência.
2. **Escreva a regra** no array da área:

   ```ts
   {
     id: 'events.home-away-differ',
     sport: 'all', // um slug ('football'), 'all' (resultado por esporte) ou um balde ('watch', 'geo')
     area: 'events',
     severity: 'high',
     description: {
       'pt-BR': 'Mandante e visitante são times diferentes',
       en: 'Home and away are different teams',
       es: 'Local y visitante son equipos distintos',
     },
     origin: 'erro achado por <quem> em <data>: <o caso>', // quando veio de um erro achado à mão
     needs: [], // 'api' | 'f1db' | 'wikidata': sem a fonte, a regra sai skipped
     check: async (ctx) => {
       const rows = await ctx.db.execute<{ id: string; sport: string; label: string }>(sql`...`);
       return {
         checked: { football: 1000 },
         failures: rows.map((r) => ({
           key: r.id, // estável entre execuções: é o que mantém o "desde"
           sport: r.sport,
           label: r.label,
           current: 'o que está errado',
           expected: 'o que deveria ser',
           link: { type: 'event', id: r.id }, // participant | event | person | competition | platform | country
         })),
       };
     },
   },
   ```

   - **`checked`:** um número para regra de um esporte, ou um objeto por esporte para regra `all`.
   - **`failed`:** devolva só quando `failures` é uma amostra, e a regra tem a contagem completa (veja `events.ts`). O motor guarda no máximo 200 falhas por regra e esporte.
   - **`ctx.memo(chave, carga)`:** use quando várias regras leem a mesma coisa (as quatro da F1 leem os pilotos da API uma vez só).
   - **Regra nova, área nova:** acrescente o array em `rules/index.ts`.
3. **Ponha a lógica num helper puro**, como `eraNameOk`, `categoryFromWikidata` ou `priceHasCurrency`. Teste-o em `rules/rules.test.ts`, com **o caso real que motivou a regra**. Se a regra veio de um erro achado à mão, acrescente o id ao teste "cada erro achado pelo dono do produto tem uma regra" (`engine.test.ts`).
4. **Rode a prévia no dev** (`quality:run --plan --regras <id> --md falhas.md`) e leia as falhas.
   - Falso positivo é bug da regra: ajuste antes de abrir o PR. Exemplos: o empate de corridas na F1 aceita qualquer construtor empatado, e "Holanda" não é erro para NL.
   - O que sobrar é dado errado de verdade: vira issue ou correção, e o placar acompanha.
5. O painel não precisa de mudança. A descrição vem de `ops.quality_rule`, regravada a cada execução a partir do código. Só um **balde** novo (como `watch` e `geo`) pede o nome em `ops.ts` (`quality.sports`), nos três idiomas.

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `ops.quality_rule` | Catálogo: id, esporte, área, severidade, descrição nos três idiomas e origem. |
| `ops.quality_run` | Uma linha por execução gravada, com o gatilho (`schedule`/`cli`). |
| `ops.quality_result` | Placar: regra × esporte × execução, com status, conferidos, errados e motivo. Quando uma regra roda e um esporte que tinha resultado não vem mais (ex.: regra `all` sem itens dele), o esporte ganha um `pass` zerado, para a falha antiga não ficar no placar. |
| `ops.quality_failure` | Itens errados: chave, rótulo, atual, esperado, link e `first_seen_at`. A falha que continua no resultado seguinte da mesma regra × esporte mantém a data em que apareceu, mesmo com uma execução filtrada (`--regras`/`--esporte`) ou um `error` no meio. |

Migration `0034_qualidade_dados`.
