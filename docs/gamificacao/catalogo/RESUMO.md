# RESUMO do Catálogo de Conquistas, Cartas e cosméticos

Entregável da missão de 16/11/2026. Tudo gerado e validado em `docs/gamificacao/catalogo/` (`node docs/gamificacao/catalogo/_validar.mjs` → 0 erros, 24 avisos, todos declarados abaixo). Nada entrou no banco: a importação é um passo à parte, depois das respostas do dono ([pesquisa/consolidado.md](pesquisa/consolidado.md)).

## 1. Números finais

| Pacote | Conquistas | Ativas | Inativas | Cartas | Comum | Especial | Rara | Histórica | Lendária |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `common` | 34 | 26 | 8 | 158 | 31 | 63 | 33 | 23 | 8 |
| `football` | 29 | 24 | 5 | 89 | 15 | 32 | 21 | 10 | 11 |
| `basketball` | 29 | 25 | 4 | 89 | 15 | 34 | 18 | 12 | 10 |
| `nba` | 28 | 24 | 4 | 100 | 18 | 40 | 21 | 9 | 12 |
| `american-football` | 30 | 25 | 5 | 74 | 11 | 25 | 20 | 10 | 8 |
| `baseball` | 26 | 22 | 4 | 90 | 16 | 37 | 18 | 7 | 12 |
| `hockey` | 27 | 22 | 5 | 79 | 13 | 36 | 15 | 8 | 7 |
| `volleyball` | 26 | 21 | 5 | 74 | 12 | 27 | 18 | 9 | 8 |
| `handball` | 27 | 22 | 5 | 83 | 14 | 33 | 18 | 9 | 9 |
| `rugby` | 28 | 23 | 5 | 80 | 13 | 27 | 21 | 13 | 6 |
| `afl` | 28 | 23 | 5 | 64 | 9 | 22 | 16 | 11 | 6 |
| `formula-1` | 23 | 17 | 6 | 87 | 16 | 35 | 19 | 7 | 10 |
| `mma` | 25 | 19 | 6 | 105 | 20 | 41 | 23 | 10 | 11 |
| **Total** | **360** | **293** | **67** | **1.172** | 203 | 452 | 261 | 138 | 118 |

- As 9 Conquistas que já existem no banco mantêm id, nome, descrição, Degraus e bônus (`predictions.*`, `loyalty.watched`, `knowledge.trivia`, `community.poll`, `consumption.recap`).
- 109 Coleções ([cartas/colecoes.json](cartas/colecoes.json)); cada Carta está em exatamente uma.
- Cosméticos ([cosmeticos/](cosmeticos/README.md)): 10 Níveis, 32 molduras (6 por Nível, 18 por Coleção, 8 por Degrau Lendário; 7 animadas), 59 fundos (54 por Coleção, 5 por Nível), 52 títulos (37 por Coleção, 15 por Degrau Lendário). Nenhum destrave por compra.
- Das 67 inativas, 43 esperam estatística de jogador por partida ou lance a lance fora do futebol (`proposed.player_game_stats.*`, `proposed.event.play_by_play`); o resto espera um parâmetro novo na linguagem ou um campo do Perfil (piloto/lutador do coração, fuso individual).
- Linguagem de regras: [regras/linguagem.md](regras/linguagem.md) (3 entradas, 15 fatos, filtros `where`, contagem `each`/`distinct`/`streak`, com [JSON Schema](regras/regra.schema.json)). Pesquisa por esporte em [pesquisa/](pesquisa/), com fonte (URL) para cada frequência ou a marca "estimativa própria".

Os 24 avisos do validador são Degraus que crescem menos de 2x de propósito: sequências (um acerto a mais é exponencialmente mais difícil), exploradores com teto real (12 esportes, 18 clubes, 7 meses, ~9 países) e as Platinas longas da NBA (82) e do beisebol (81). Cada um está justificado na pesquisa do pacote.

## 2. As 10 decisões tomadas (e por quê)

1. **A frequência se mede do lado do torcedor.** A missão falava em "% dos jogos da liga"; a raridade útil é "quantas vezes por temporada isso acontece com o time do coração". Faixas fixadas em [padronizacao.md](padronizacao.md): mais de 5 por temporada vira repetível com 5 Degraus; 2 a 5 `special`; 0,5 a 2 `rare`; 0,1 a 0,5 `historic`; menos de 0,1 `legendary`. Sem isso cada pacote mediria de um jeito.
2. **Sete exceções declaradas à régua**, para o fato mais reconhecido do esporte ter progressão de Cartas mesmo com 3 a 5 ocorrências por temporada: clássico no futebol e no futebol americano, virada no 3º período no hóquei, tie-break no vôlei, playoff no basquete e na NBA, vitória fora no AFL, madrugada na F1. Lista completa em [consolidado.md](pesquisa/consolidado.md), para aprovar ou derrubar em bloco.
3. **Bônus de momento abaixo do acerto.** Momento repetível: 10/20/40/75/150 (metade do acerto, porque estar lá é mais fácil que acertar). Momento único pela raridade da Carta: 10/25/60/120/200; até o Histórico nunca passa de um placar exato (120) e o Lendário fica abaixo do Degrau Lendário de acerto (300). Participação e consumo seguem com bônus zero.
4. **Raridade de Carta é escala própria, mecânica nas contagens.** Degrau 1 `common`, 2 e 3 `special`, 4 `rare`, 5 `legendary` para acerto e momento e `historic` para participação e consumo. Só a Conquista única tem raridade pela frequência real. Isso deixa o álbum legível sem ler a Conquista.
5. **Conquista inativa carrega uma regra válida de aproximação** e `proposed.*` em `requires_data`; o importador nunca liga uma Conquista com `proposed.`. Assim o Catálogo mostra o que quer existir, sem prometer o que o motor não lê.
6. **Basquete e NBA são dois pacotes com o mesmo conteúdo e limiares diferentes** (ligas sul-americanas fazem 80 a 85 pontos por jogo, a NBA 114): quarto 30+ contra 40+, Platina de fidelidade 38 contra 82. Um limiar só esvaziaria um dos dois.
7. **Id sem hífen.** A restrição `catalog_achievement_id` do banco rejeita hífen; os prefixos são `american_football.` e `formula_1.` em todo id derivado, e o campo `sport` mantém o slug (`american-football`, `formula-1`).
8. **Três correções no contrato de dados** em relação ao que foi ao Codex ([regras/contrato-dados.md](regras/contrato-dados.md)): os tipos de lance do futebol são minúsculos e já separam `goal`, `own_goal`, `penalty_missed`; a fase é `event.stage.kind` (canônico), não o nome traduzido; não existe `fan.time_zone`, a hora local sai de `program.time_zone` (o país do programa), aproximação declarada nas Conquistas de madrugada e coruja.
9. **Dois fatos transversais na linguagem** (`game.result`, `game.comeback`) para as Conquistas comuns "eu estava lá" valerem no futebol e nos esportes de período com uma regra só; nos pacotes de esporte vale o fato do esporte, com mais parâmetros.
10. **Espanhol latino-americano neutro, com duas escolhas lexicais declaradas:** "arquero" (não "portero") e "sobre la chicharra" (não "sobre la bocina"). Nenhum voseo, nenhum "vosotros". Se o mercado mexicano pesar mais, as duas trocas são buscar-e-substituir.

Também decidido: nomes de Conquista são únicos **dentro do pacote**, não entre pacotes (há "Vitória em final", "Sem perder um jogo" e "Sequência certeira" em vários esportes, de propósito: a estante é por esporte e o nome natural é o mesmo); o que a missão chamava de `catalogo/<esporte>.json` ficou em `conquistas/`, para não repetir o nome da pasta-raiz; os ids de cosmético pedidos por duas Coleções diferentes foram desambiguados (`title.fourth_quarter_closer`, `frame.crosstown`).

## 3. O que o motor precisa para rodar o Catálogo inteiro

| Peça | Estado | Destrava |
| --- | --- | --- |
| Entrada `moment` avaliada no fim do jogo contra os Perfis com presença | a construir (seção 7 de [linguagem.md](regras/linguagem.md)) | toda a família `moments` e `results` (142 Conquistas ativas) |
| Filtros `where` na montagem da entrada | a construir | clássico, fase, hora local, dia da semana, time do coração |
| `count.distinct` (tabela de chaves vistas) e `count.streak` (dois campos no progresso) | a construir | exploradores e sequências (46 Conquistas) |
| Instante do lance a partir do `event_state_log` | a construir | `presence: at_moment` no futebol (9 Conquistas) |
| Estatística de jogador por partida fora do futebol | depende do fornecedor e da carga | 43 Conquistas inativas |

## 4. Perguntas para o dono

As 112 perguntas dos 13 pacotes estão consolidadas em 50 únicas, por tema, em [pesquisa/consolidado.md](pesquisa/consolidado.md), junto com as 35 extensões de linguagem pedidas e seu custo. As três que mais mudam o Catálogo, e que valem responder antes da importação:

1. **`event.derby_id` existe em que esportes, e com que critério?** Nove pacotes dependem disso para a família de clássico (futebol, beisebol, futebol americano a calibrar; sete esportes a incluir ou não).
2. **O que é `final` e como as fases de playoff chegam em `stage.kind`?** Final em série (melhor de 7) ou ida e volta conta por jogo; finais de conferência; etapas de sevens. Afeta toda Conquista com `where.stage` nos dez esportes de time e nas comuns.
3. **`fan.favorite_team_id` aceita seleção?** Sem isso vôlei, handebol e rugby, onde o público do Brasil e da América hispânica torce por seleção antes de clube, perdem metade do que o pacote calibrou.

Logo atrás: aprovar em bloco as 7 exceções à régua; ~~decidir o gênero de "Rei do placar exato" e "Madrugador"~~ (decidido em 19/11: nomes neutros, "Placar exato" e "Na madrugada"); o estilo de arte já foi decidido: **Galaxie (galáctico)**, provado no lote 0 de 16/11 e aplicado a todos os prompts.

## 5. Arte: lote 0 e estilo padrão (16/11)

Cinco Cartas de "Gol nos acréscimos" geradas pelo Magnific no estilo A, depois três no estilo galáctico e a Carta Bronze em três paletas de cliente (só cores, nunca marca). O dono aprovou o lote e **escolheu o estilo Galaxie (galáctico) como padrão**: a frase dele substituiu a do vetor plano em todas as Cartas e nos cosméticos; o guia de arte traz o estilo (seção 2.5) e o tema por cliente pela paleta (seção 7.1). Registro e custo na issue #1283. **Orçamento (seção 6.5 do guia):** 50 créditos por Carta no modelo que entrega o estilo (os baratos foram testados e reprovados); o Catálogo inteiro custaria 58,6 mil, então a geração vai por portões: 7 Cartas-ouro agora, um conjunto de demonstração quando a estante mostrar placeholder, comuns e futebol quando o motor conceder os momentos, os outros esportes quando houver cliente; nunca Carta de Conquista inativa nem Catálogo regerado para prospect (o tema do cliente padrão é a interface nas cores dele, sem crédito).

## 6. Revisão independente (16/11)

O Codex ficou sem cota, então um revisor de leitura percorreu as 1.172 Cartas, as 109 Coleções, os cosméticos e as 360 Conquistas. Achou 4 itens que violavam regra fixa, todos de vocabulário e já corrigidos: "pleno" (jargão de aposta em espanhol) virou "acierto total" / "de lleno"; "octógono" (marca) virou "gaiola" / "jaula"; "placares cravados" (gíria de aposta) virou "placares exatos gravados"; "você já sabe onde dói" (MMA, 13+) virou "onde fecha". Dos 24 ajustes de idioma e coerência, 21 foram aplicados (léxico latino-americano unificado em "tiempo extra", "narrador", "gimnasio", "clavada"; inglês literal; provocação a rival em 6 versos; duas descrições que prometiam mais que a regra). Ficaram como decisão registrada: "fecha" e "jornada" convivem; nomes de até 4 palavras valem; e **37 das 109 Coleções têm Carta de Conquista inativa (5 só de inativas)**, então aparecem na estante com a Carta em silhueta e só fecham quando a Conquista ligar.

## 7. Como importar (quando aprovado)

1. Responder as perguntas de [consolidado.md](pesquisa/consolidado.md) e ajustar os pacotes afetados (cada pacote tem o gerador que o produziu; regenerar e revalidar).
2. Mapear cada caminho de `requires_data` para a base e conferir as regras de momento contra jogos reais (um jogo por fato, no mínimo).
3. Gerar o seed de `game.catalog_achievement` e `game.catalog_step` a partir de `conquistas/*.json` (as 9 existentes entram como `UPDATE`, as outras como `INSERT ... ON CONFLICT DO NOTHING`), e os nomes dos 10 Níveis em `game.level_def`.
4. Gerar a arte (1.172 Cartas, 32 molduras, 59 fundos, 10 selos) com os prompts, em lote por Coleção com seed fixa, e passar pela revisão humana do checklist do [guia de arte](arte/guia.md).
