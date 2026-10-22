# 01 · Visão de produto

> **Galaxie Sports** é uma plataforma B2B de dados esportivos para operadoras de TV paga, serviços OTT e produtos digitais da América Latina. Ela entrega o **evento esportivo como entidade principal**: agenda, estado ao vivo, contexto competitivo, onde assistir e uma camada semântica com a cara da torcida (clássicos, apelidos, gritos de guerra) — em português e nos espanhóis da região.

## 1. O problema

Plataformas de vídeo que querem ser "a casa do esporte" esbarram sempre nos mesmos pontos:

| Dor | Consequência para o usuário final |
|---|---|
| Dados esportivos crus e caros, presos a um fornecedor | Experiências pobres, cards sem contexto, custos altos por chamada |
| O evento só existe se o canal transmite | O usuário volta para o Google para saber "o que está rolando" |
| "Onde assistir" é fragmentado por país, canal, streaming e região | A pergunta mais comum do torcedor fica sem resposta confiável |
| Dados frios (IDs, placares) sem identidade cultural | Nenhuma emoção: o produto não sabe que Palmeiras x São Paulo é o **Choque-Rei** |
| Linguagem traduzida literalmente do português para o espanhol | "Secar o rival" não tem equivalente único no Cone Sul; copy soa artificial |

A imagem abaixo mostra o comportamento que queremos internalizar: o torcedor pergunta ao buscador "onde assistir" e recebe canais, horário, local e o cenário da partida. **Nosso serviço precisa responder isso dentro da plataforma do cliente, com fonte, confiança e atualização automática.**

![Exemplo de resposta de buscador para "onde assistir"](images/referencias/exemplo-onde-assistir-busca.png)

## 2. A proposta

Um serviço único, multiesporte e evergreen (não é um projeto de Copa do Mundo) composto por sete módulos:

| # | Módulo | O que entrega | Diferencial |
|---|---|---|---|
| M1 | **Data Mirror** | Cópia interna da api-sports.io (12 APIs) com **a mesma estrutura de resposta** | Demo e clientes não gastam cota do fornecedor a cada requisição |
| M2 | **Event Foundation** | Entidade `event` canônica multiesporte, estado ao vivo, *last-known-good*, momentum temporal | O evento existe mesmo que ninguém o transmita |
| M3 | **Where to Watch** | Opções de transmissão por evento × país (TV aberta, TV paga, streaming, YouTube), com fonte, confiança e `last_verified_at` | Correções propagadas em ≤ 5 min; conflitos omitidos, nunca "chutados" |
| M4 | **Semantic Knowledge Base** | Clássicos, apelidos, mascotes, gritos de torcida, rivalidades, apelidos de competições e dicas de copy por locale | Pré-cadastrado e versionado — não depende de consulta em tempo real |
| M5 | **AI Live & Enrichment** | Agendador inteligente de polling ao vivo + agentes de IA para "onde assistir", cenário pré-jogo ("quem precisa de quê"), resumo pós-jogo | IA só enriquece; placar e eventos vêm sempre da fonte de dados |
| M6 | **Olympics & Pan-Am** | Quadro de medalhas, agenda por modalidade, atletas latino-americanos, histórico | Cobertura de eventos multiesportivos que a api-sports não cobre sozinha |
| M7 | **Related Content** | Links diretos para vídeos do jogo (melhores momentos, gols, pênaltis, coletiva, bastidores, reação, análise), por tipo e formato (longo × short), com selo de canal oficial — [12](12-conteudo-relacionado.md) | Fatos do core montam a busca; só metadados e embed oficial, nunca rehospedagem |

Tudo é exposto por **uma API própria** ([05-api-publica.md](05-api-publica.md)) e demonstrado por um **app de demonstração** em shadcn/ui + ReUI ([09-app-demonstracao.md](09-app-demonstracao.md)) que consome exclusivamente essa API.

## 3. Princípios de produto

1. **Evento é entidade primária.** Canal/plataforma é atributo da transmissão, não identidade do evento.
2. **Verdade de dados ≠ enriquecimento.** Placar, minuto, cartões e escalações vêm do provedor de dados. A IA nunca inventa um fato ao vivo.
3. **Confiança explícita.** Toda informação enriquecida carrega `source`, `confidence`, `last_verified_at` e `review_status`. Baixa confiança é omitida.
4. **Last-known-good.** Se o provedor falhar (4xx/5xx, payload vazio), servimos o último estado válido e seguimos o ciclo temporal pelo horário previsto.
5. **Economia de chamadas por design.** Cada requisição ao fornecedor é planejada, contabilizada e reaproveitada (ver [03](03-ingestao-e-economia-de-chamadas.md)).
6. **Localização por intenção, não por tradução.** pt-BR, es-AR, es-MX, es-CO, es-CL, es-PE, es-UY e es-EC têm bibliotecas de copy independentes.
7. **Linguagem segura.** Torcer a favor, nunca ofender o rival. Copy de rivalidade só quando o usuário declarou o rival explicitamente.
8. **Neutralidade de cliente.** A plataforma é *white-label*: nenhuma marca de cliente aparece na API, nos dados ou na documentação.

## 4. Para quem

| Persona B2B | Necessidade | Módulos |
|---|---|---|
| Operadora de TV paga / OTT | Hub esportivo na TV conectada, cards ao vivo, "onde assistir" com upsell | M1–M5 |
| Produto digital / app de mídia | Agenda, placares e contexto para conteúdo editorial | M1, M2, M4 |
| Time de CRM / marketing | Afinidade com times para campanhas segmentadas | M4 (afinidades), M2 (agenda) |
| Equipe editorial | Pautas, clássicos da semana, cenários de classificação | M4, M5 |

Experiências típicas que o cliente constrói sobre a API (e que o app de demonstração reproduz):

| Experiência | Pergunta que responde | Endpoints principais |
|---|---|---|
| **Meu dia esportivo** | O que de mais relevante para mim acontece hoje? | `GET /v1/events?date=today&for=profile` |
| **Âncora de esportes** | Quais esportes eu sigo, em que ordem? | `GET /v1/sports` + afinidades |
| **Radar / agenda** | O que vem por aí no esporte/torneio que escolhi? | `GET /v1/events?sport=&competition=&from=` |
| **Contexto competitivo** | O que está em jogo? Tabela, fase, chaveamento | `GET /v1/competitions/{id}/context` |
| **O que rolou** | Resultados, momentos-chave, estatísticas | `GET /v1/events/{id}/timeline` |
| **Explorar times** | Elenco, forma recente, próximos jogos, torneios | `GET /v1/teams/{id}/overview` |
| **Onde assistir** | Em que canal/plataforma vejo este jogo no meu país? | `GET /v1/events/{id}/where-to-watch?country=BR` |
| **Adicionar ao calendário** | Lembrete do jogo | `GET /v1/events/{id}.ics` |

## 5. Escopo esportivo

**Futebol é o foco inicial**, com prioridade para:

- **Brasil**: Brasileirão Série A (e B/C/D em segundo nível), Copa do Brasil, estaduais (Paulistão, Carioca, Mineiro, Gaúcho, Paranaense, Baiano, Pernambucano, Cearense, Goiano, Catarinense), Copa do Nordeste, Supercopa.
- **CONMEBOL**: Libertadores, Sul-Americana, Recopa, Eliminatórias, Copa América.
- **Ligas nacionais**: Argentina, Chile, Uruguai, Colômbia, Peru, Equador, Paraguai, Bolívia, Venezuela e México (Liga MX).
- **Europa**: Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Primeira Liga, Eredivisie, Champions, Europa League, Conference League.
- **FIFA**: Copa do Mundo, Mundial de Clubes, Copa do Mundo Feminina, torneios de base, futebol olímpico.

O catálogo completo, com IDs da api-sports e níveis de prioridade, está em [`config/competitions/football.yaml`](../config/competitions/football.yaml).

As outras 11 APIs da api-sports (AFL, beisebol, basquete, Fórmula 1, handebol, hóquei, MMA, NBA, NFL, rúgbi e vôlei) entram no Data Mirror desde o início e ganham enriquecimento progressivamente. **Olimpíadas e Jogos Pan-Americanos** têm um módulo próprio ([08](08-olimpiadas-e-panamericano.md)).

## 6. Proposta comercial (hipótese a validar)

O valor está no que **não** é commodity: confiabilidade do "onde assistir", camada semântica curada, IA de contexto e localização para 8 mercados. Os pacotes sugeridos:

| Pacote | Inclui | SLA sugerido | Racional de preço |
|---|---|---|---|
| **Core Data** | M1 + M2 (agenda, placares, tabelas, times, atletas, assets) | 99,5% · atualização ao vivo ≤ 60 s | Por volume de requisições/mês + número de esportes |
| **Fan Experience** | Core + M3 (onde assistir) + M4 (semântica) + copy localizada | 99,9% · correção WTW ≤ 5 min | Por mercado (país) ativo |
| **Live Intelligence** | Fan Experience + M5 (IA ao vivo, cenário, resumos) + M6 | 99,9% · ao vivo ≤ 15 s (plano pago do fornecedor) | Por evento enriquecido + mercados |
| **Add-on Related Content** | M7 (vídeos relacionados por evento) sobre qualquer pacote; incluído no Enterprise | — | Por evento enriquecido |
| **Enterprise / White-label** | Tudo + ambiente dedicado, webhooks, suporte 24×7, curadoria editorial dedicada | Contratual | Contrato anual |

> ⚠️ **Licenciamento**: os termos da api-sports **proíbem revender os dados**. O espelho api-sports é a base de **desenvolvimento e demonstração**; para vender, é preciso acordo por escrito com o fornecedor ou plugar a fonte licenciada do próprio cliente na camada de provedores. O valor cobrado está no que é nosso: semântica, onde assistir, IA, normalização multiesporte e localização — ver [11-seguranca-licenciamento-e-compliance.md](11-seguranca-licenciamento-e-compliance.md).

## 7. Indicadores de sucesso do serviço

| Indicador | Meta inicial |
|---|---|
| Chamadas ao fornecedor por dia (plano free) | ≤ 100 por API, com ≥ 15% de reserva |
| Cobertura de "onde assistir" para jogos tier 1 (BR) | ≥ 95% dos jogos com ≥ 1 opção confirmada até T-3h |
| Precisão do "onde assistir" (auditoria amostral) | ≥ 98% |
| Latência p95 da nossa API (cache quente) | ≤ 150 ms |
| Times tier 1 com semântica `approved` | 100% |
| Atraso de placar ao vivo (plano pago) | ≤ 30 s em relação à fonte |
