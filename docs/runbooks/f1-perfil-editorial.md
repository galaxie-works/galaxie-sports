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

O agente (`services/ai-agents/src/f1bio/profile.ts`) pesquisa com busca (Gemini com grounding) e descarta, com o motivo no relatório:

- item sem fonte, com fonte que não veio da busca ou de domínio não permitido;
- número que não está nos fatos do F1DB (totais, temporadas, corridas da lista, pistas, datas e idade) — o FactSheet dos guardrails;
- momento numa corrida fora da lista do piloto (a chave `<ano>-<rodada>`), e rival que não largou nas mesmas corridas;
- termo proibido, padrão de prompt injection, texto em outro idioma ou com cara de letra de música.

Sem a bio, ou lenda sem nenhum momento verificável, não há proposta. O tom de referência no prompt é o do texto de transmissão esportiva (momentos concretos, traços que dão para ver na pista); o prompt cita o Senna como nível de detalhe esperado, não como texto a copiar.

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
