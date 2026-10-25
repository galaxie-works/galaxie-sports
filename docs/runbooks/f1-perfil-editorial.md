# Perfil dos pilotos de F1: traços calculados e perfil editorial

A página do piloto tem dois blocos além da carreira:

- **Estilo e pistas**: os traços calculados do F1DB, sem IA, para todo piloto (`GET /v1/teams/{id}/traits`);
- **Momentos**: o perfil editorial das lendas, com fonte por item (`GET /v1/teams/{id}/editorial`), só depois de aprovado no painel de revisão.

## Nível de cada piloto

O nível diz o que o perfil traz. A regra é `driverTier` (`packages/knowledge/src/editorial.ts`), sobre o core:

| Nível | Critério | Perfil |
| --- | --- | --- |
| `legend` (lenda) | campeão mundial, ou entre os 20 primeiros da história em vitórias ou em GPs disputados (empatado com o 20º também entra) — o mesmo escopo `lendas` do acervo de fotos | bio editorial, estilo, pontos fortes, momentos marcantes e rivalidades |
| `regular` | venceu ao menos um GP, ou disputou 3 temporadas ou mais | bio curta (2 ou 3 frases) e os traços |
| `basic` | os demais | só os traços calculados (nada de IA) |

Título só conta em temporada encerrada (a liderança do ano corrente não é título). Em outubro de 2026, no dev: 49 lendas e 341 regulares. O top 20 de GPs põe pilotos de carreira longa sem título entre as lendas (Hülkenberg e Stroll, por exemplo): é o critério pedido, e mudar `LEGEND_TOP` muda os dois lados (API e agente).

## Traços calculados (`/v1/teams/{id}/traits`)

Corrida = sessão `Race` (sprint fora); pole = 1º na classificação do GP, como na carreira; chegada conta só com bandeirada (posição numérica).

- **Pistas preferidas**: por circuito, largadas, vitórias, pódios, poles, melhor chegada e chegada média. As 3 melhores, na ordem vitórias → pódios → poles → chegada média, com pelo menos 2 largadas no circuito (`circuits.criterion` na resposta).
- **Sábado × domingo**: poles por largada, largada média, chegada média e posições ganhas (largada − chegada, só corridas com as duas). O rótulo compara o piloto ao companheiro de equipe, que tem o mesmo carro: com 20 duelos ou mais de cada, quem vence o duelo de grid 10 pontos percentuais acima do de corrida é **piloto de classificação**; o contrário, **piloto de corrida**; no meio, **equilibrado**. Senna: 89% no grid e 78% na chegada, piloto de classificação.
- **Contra o companheiro**: na mesma corrida, pela mesma equipe. Duelo de grid = os dois com posição de largada; duelo de corrida = os dois com bandeirada (abandono de um deles não entra). Por temporada, por companheiro e na carreira.
- **Consistência**: abandonos (DNF) por largada, pontos das corridas por largada e as maiores sequências de vitórias, pódios e GPs nos pontos. Sem os pontos no resultado (api-sports), a tabela de 2010 em diante pela chegada.
- **Chuva**: a F1DB não marca corrida com chuva, e o `weather` da api-sports vem vazio. O desempenho na chuva fica no perfil editorial, com fonte (`moments[].wet` e o ponto forte `wet_weather`).

## Perfil editorial (`/v1/teams/{id}/editorial`)

Estrutura fixa em `data/knowledge/formula-1/editorial/<locale>.yaml` (formato no [SCHEMA.md](../../data/knowledge/SCHEMA.md)): bio, estilo (`kind` de uma lista e texto curto), pontos fortes, momentos marcantes (corrida, ano, rodada, chuva, o que aconteceu e a fonte) e rivalidades. Original em pt-BR; tradução em `es` (espanhol neutro), item a item, com as mesmas fontes.

O agente (`services/ai-agents/src/f1bio/profile.ts`) pesquisa com busca (Gemini com grounding). Regras do projeto: **ninguém mexe na resposta do Gemini antes do validador, e o validador nunca barra sozinho**. Cada problema vira um achado (`findings` no item do YAML: campo, início e fim do trecho no texto, regra, motivo e gravidade). Toda proposta com bio vai para o painel como rascunho, com o trecho destacado.

| Gravidade | Regras |
| --- | --- |
| **grave** (fato a conferir) | número fora dos fatos do F1DB (FactSheet: totais, temporadas, corridas da lista, pistas, datas e idade; o número de nome de chassi, como BT52, não conta, mas posição e sessão como P2 e Q3 contam); corrida que o piloto não disputou (fora da lista `<ano>-<rodada>`; o momento fica sem ano e rodada, sem ligar o evento de outra corrida); rival que não largou nas mesmas corridas; prompt injection; fonte ausente, que não veio da busca ou de domínio não permitido |
| **alerta** (texto) | termo da lista de proibidos ("agressivo" em contexto de pilotagem, como "pilotagem agressiva" ou "agressivo nas freadas", não conta; fora da pista, conta); nome do GP do momento que não é o da corrida da chave; cara de letra de música; outro idioma; tamanho acima do pedido; marcador de citação (`[S1]`) no texto; item repetido; lenda sem momento; tradução com outro número de itens |

Só não há proposta sem bio. O painel (tipo "Perfil de piloto (F1)") mostra o selo "N alertas / N graves" na lista e, no item, cada campo com o trecho destacado (vermelho = grave, âmbar = alerta) e o motivo; o revisor aprova, sugere a edição ou deixa em rascunho. O tom de referência no prompt é o do texto de transmissão esportiva (momentos concretos, traços que dão para ver na pista); o prompt cita o Senna como nível de detalhe esperado, não como texto a copiar.

## Biografia factual (card "Biografia", `profile` de `/v1/teams/{id}/career`)

Fatos estruturados, sem IA, cada um com a fonte, gravados em `core.participant` pelo `f1:biografia` (migration `0038_piloto_biografia`: `full_name`, `death_date` e `bio_facts`). O card mostra só o que existe.

- **F1DB:** nome completo, data da morte e a família no automobilismo (`driver_family_relationship`: pai, filho, irmão, sobrinho, avô, primo, cunhado…; cada parente com link para o perfil).
- **Morte em corrida:** o resultado que o F1DB marca como fatal ("Fatal accident", "Fatal collision", "… in qualifying", "… in practice", "… in support race"), com o GP, a sessão e a cidade do circuito. São 28 pilotos, de Marimón a Bianchi; no caso do Bianchi, o acidente foi em Suzuka em 2014 e a morte, em 2015. A frase é um modelo fixo nos 3 idiomas da demo ("Morreu após acidente no {GP}, em {cidade}"), sem texto gerado; por isso não passa pelo painel.
- **Wikidata, com casamento estrito:** a mesma data de nascimento do F1DB e o id do piloto (P3684 Driver Database ou P8140 motorsportstats igual ao id do F1DB) ou, sem ele, o nome em inglês igual ao do F1DB e a ocupação de piloto; o candidato tem de ser único. No dev, 895 dos 917 pilotos casam (810 pelo id e 85 pelo nome). Do QID saem:
  - o local da morte (P20), só quando há um (o Senna tem o circuito e o hospital, então fica sem);
  - a causa (P509) e a circunstância (P1196);
  - os apelidos (P1449);
  - as vitórias nas 500 Milhas de Indianápolis e nas 24 Horas de Le Mans (P1346 nas edições).
- **Na dúvida, não mostra:**
  - Data da morte do Wikidata diferente da do F1DB: os fatos da morte do Wikidata ficam de fora.
  - Causa do tipo colisão (o rótulo "acidente rodoviário" do Wikidata): o card diz "Em acidente", sem o rótulo.
  - O mesmo QID para dois pilotos: nenhum dos dois fica com ele.
- **Limite conhecido:** o Wikidata registra o vencedor de Le Mans de forma incompleta. Na edição de 1972, só o Pescarolo aparece, então a Tríplice Coroa do Graham Hill não sai inteira (a vitória em Indianápolis de 1966, sim).

Comandos (na VPS, depois do deploy, no container `ingestor`):

```bash
# 1. prévia e gravação da biografia (consultas ao Wikidata cacheadas no banco por 7 dias). Sem a tabela de
#    parentesco do F1DB no raw, a CLI grava antes as páginas que faltam do release fixado (só o raw, em fluxo)
docker compose exec -T ingestor node dist/cli/f1-biografia.js --plan
docker compose exec -T ingestor node dist/cli/f1-biografia.js
# 2. limpar o cache das respostas da API (como no deploy)
for p in 'gs:cache:*' 'gs:tag:*'; do docker compose exec -T valkey sh -c "valkey-cli --scan --pattern '$p' | xargs -r -n 200 valkey-cli del >/dev/null"; done
```

## Revisão

Tudo entra como `draft`. Depois do merge e do deploy, o seed leva cada perfil × idioma ao painel (Ajustes → Revisão semântica, tipo "Perfil de piloto (F1)", item `editorial:<locale>.<slug>`). A aprovação vale na hora: a API lê o YAML, aplica a decisão e as edições do painel por cima (como no glossário), e o change feed purga o cache (`f1_editorial`). Sugestões de edição passam pelo agente de revisão (#254). A demo pede `min_review_status=approved`: o bloco "Momentos" e a bio editorial só aparecem depois da aprovação.

## Comandos de produção

O Gemini só roda na VPS, no container `agents` (a imagem precisa desta versão: rode depois do deploy). O primeiro passo não grava no banco nem no YAML; piloto com proposta aceita não é pesquisado de novo (`--refazer` pesquisa de novo).

1. **Na VPS, gerar as propostas das lendas** (1 pesquisa com fontes e 1 tradução por piloto):

   ```bash
   docker compose run --rm --no-deps -e AI_PROVIDER=gemini -v galaxie-commons:/data/commons agents \
     node ../ai-agents/dist/cli/f1-bio.js --perfil --escopo lendas --plan --saida /data/commons/f1perfil
   docker compose run --rm --no-deps -e AI_PROVIDER=gemini -v galaxie-commons:/data/commons agents \
     node ../ai-agents/dist/cli/f1-bio.js --perfil --escopo lendas --saida /data/commons/f1perfil
   docker compose run --rm --no-deps -v galaxie-commons:/data/commons --entrypoint cat agents \
     /data/commons/f1perfil/profiles.json > /tmp/f1perfil-profiles.json
   docker compose run --rm --no-deps -v galaxie-commons:/data/commons --entrypoint cat agents \
     /data/commons/f1perfil/profiles-report.md > /tmp/f1perfil-report.md
   ```

   Para os regulares, o mesmo com `--escopo regulares` (341 pilotos; `--limite N` faz em lotes). Para um piloto só: `--pilotos ayrton-senna`. O relatório mostra cada item aceito com a fonte e cada descartado com o motivo.

2. **No dev, aplicar e abrir o PR.** Os perfis entram como `draft` em `data/knowledge/formula-1/editorial/pt-BR.yaml` e `es.yaml`; perfil aprovado nunca é sobrescrito, aplicar de novo não muda nada e cada item passa pelo validador da base.

   ```bash
   pnpm --filter @galaxie/ai-agents f1:bio --perfil --aplicar f1perfil-profiles.json --plan
   pnpm --filter @galaxie/ai-agents f1:bio --perfil --aplicar f1perfil-profiles.json
   pnpm knowledge:validate
   ```

3. **Depois do merge e do deploy,** o seed leva os perfis ao painel para a aprovação.

Os traços não precisam de comando: a API calcula do core a cada leitura (cache de 1 h, o mesmo da carreira).
