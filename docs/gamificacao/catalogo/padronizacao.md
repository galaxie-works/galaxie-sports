# Padronização do Catálogo de Conquistas, Cartas e cosméticos

Guia curto para quem cria uma Conquista, Carta ou cosmético novo. O [validador](_validar.mjs) aplica tudo o que é mecânico daqui; o resto é revisão de gente.

## 1. Ids

- Conquista: `<esporte|common>.<familia>.<nome_curto>`, minúsculas, `_`, só `[a-z0-9_.]`, até 80 caracteres (é a restrição `catalog_achievement_id` do banco). Ex.: `football.moments.stoppage_time_goal`, `common.explorer.competitions`. Esporte cujo slug tem hífen usa sublinhado no prefixo do id e em todo id derivado (Coleção, cosmético): `american_football.results.shutout_win`, `formula_1.moments.pole_to_win`; o campo `sport` continua com o slug (`american-football`, `formula-1`).
- As 9 Conquistas que já existem no banco mantêm o id antigo, sem prefixo (`predictions.correct`, `loyalty.watched`…). Nenhuma outra nasce sem prefixo.
- Basquete e NBA têm pacotes separados (`basketball.*` e `nba.*`), mesmo quando a regra é igual: o calendário e os Degraus mudam.
- Carta: `card_key` = `<id da Conquista>.<degrau>` (`football.moments.stoppage_time_goal.1`).
- Coleção: `<esporte|common>.<nome_curto>` (`football.last_minute`, `common.explorer`).
- Família (valores fixos; `family` do JSON): `predictions` (Palpites), `loyalty` (Fidelidade), `explorer` (Explorador), `moments` (Momentos), `knowledge` (Conhecedor), `community` (Comunidade), `consumption` (Consumo), `collector` (Colecionador), `rhythm` (Madrugador e coruja, calendário), `results` (resultados do seu time, para `moment` de fim de jogo).
- Cosmético: `level.<n>`, `frame.<nome_curto>`, `background.<esporte|common>.<nome_curto>`, `title.<nome_curto>`.
- Listas ordenadas por id (ou `card_key`) em todo arquivo JSON.

## 2. Tom de voz dos nomes e textos

- Nome: 1 a 4 palavras (até 32 caracteres), orgulho, sem trocadilho de aposta, sem provocação a rival. Ex.: "Na mosca", "Fiel", "Virada épica".
- Descrição: uma frase, o que fazer, até 120 caracteres. Fala com o torcedor ("Acompanhe…", "Esteja lá quando…").
- Verso da Carta (`flavor`): até 80 caracteres, frase de arquibancada, sem citação real.
- Três idiomas sempre: `pt` (Brasil), `es` (neutro latino-americano: sem voseo, sem "vosotros", sem regionalismo de um país só; "partido", "hinchada", "marcador", "tiempo extra" (não "prórroga" nem "suplementario"), "narrador" (não "relator"), "gimnasio" (não "pabellón"), "clavada" (não "volcada"); "fecha" e "jornada" valem as duas; "arquero" e "chicharra" são as escolhas declaradas), `en` (natural, não literal). Cada idioma soa como se tivesse nascido nele. Em espanhol, "pleno" é jargão de aposta: nunca.
- Nada de entidade real em texto nenhum: clube, seleção, liga, competição, estádio, atleta, técnico, árbitro, marca, patrocinador, mascote, bordão. Inclui siglas de liga. O validador tem uma lista de alerta, mas a busca final é de quem revisa.
- Nada de compra, sorte, troca ou aposta (nem "green", "odd", "cravou a aposta", "apuesta", "cuota", "bet", "wager").
- Público 13+: sem violência gráfica (no MMA: "finalização", "nocaute", nunca o dano), sem álcool, sem linguagem chula.

## 3. Categorias, Degraus e bônus

| `category` | O que mede | `stepped` | Bônus por Degrau |
| --- | --- | --- | --- |
| `participation` | fez algo (assistiu, palpitou, votou) | sim | **0** (já pontuou em cada ação) |
| `hit` | acertou | sim | 20, 40, 80, 150, 300 |
| `moment` | estava lá quando aconteceu | sim (fato repetível) ou não (fato único) | repetível: 10, 20, 40, 75, 150; único: pela raridade da Carta (abaixo) |
| `consumption` | consumiu conteúdo | sim | **0** |

Bônus da Conquista de momento **única** (`stepped: false`, um Degrau, `threshold: 1`), pela raridade da Carta:

| Raridade | Bônus |
| --- | --- |
| `common` | 10 |
| `special` | 25 |
| `rare` | 60 |
| `historic` | 120 |
| `legendary` | 200 |

Por que assim: estar lá é mais fácil que acertar, então o momento repetível vale metade do acerto por Degrau. O momento único vale pela raridade do fato: até o Histórico ele nunca passa de um placar exato (120), e o Lendário (200), que acontece de anos em anos, fica abaixo do Degrau Lendário de acerto (300). Nenhum bônus faz clicar valer mais que acertar: os de participação e consumo são zero.

### Degraus

- Cinco Degraus para Conquista de contagem: Bronze, Prata, Ouro, Platina, Lendário. Cada um pede cerca de **2,5 a 3 vezes** o anterior; o Bronze sai no primeiro dia.
- **Platina = uma temporada** do esporte, do ponto de vista de um torcedor assíduo (os jogos do time dele numa liga de 38 rodadas; as corridas de um ano; as lutas que ele acompanha num ano). **Lendário = 2 a 3 temporadas**, com meta de menos de 1% dos torcedores ativos.
- A tabela de calendário por esporte está em [calendario.md](calendario.md); a função `seasonSteps(seasonGames)` do `packages/game-rules` dá os limites a partir dos jogos da temporada (`[1, 5, 15, 38, 100]` para 38).
- Conquista de momento repetível: o Platina é quantas vezes o fato tende a acontecer para o time de um torcedor numa temporada (frequência real × jogos da temporada), arredondado; se der menos de 5, a Conquista é única.
- Conquista de momento única: `stepped: false`, um Degrau só, `threshold: 1`.
- Conquista inativa (`active: false`) carrega mesmo assim uma `rule` válida na linguagem, a melhor aproximação do que ela deveria ser, e o `inactive_reason` diz o que falta; o importador nunca liga uma Conquista com `proposed.` em `requires_data`.

## 4. Raridade das Cartas

Escala separada do Degrau (decisão do dono, 16/11). O Degrau usa metal e mede o avanço do torcedor; a raridade mede o quanto o fato é raro no mundo real. Nunca metal nem jargão de game (`uncommon`, `epic`).

| `rarity` | pt-BR | es | en | Uso |
| --- | --- | --- | --- | --- |
| `common` | Comum | Común | Common | fato frequente (na maioria dos jogos), ou o Bronze de qualquer contagem |
| `special` | Especial | Especial | Special | acontece em parte dos jogos; Prata e Ouro de contagem |
| `rare` | Rara | Rara | Rare | poucas vezes por temporada numa liga; Platina de contagem |
| `historic` | Histórica | Histórica | Historic | uma ou poucas vezes por temporada em todo o esporte; Lendário de contagem de participação e consumo |
| `legendary` | Lendária | Legendaria | Legendary | raríssimo (anos entre ocorrências); Lendário de contagem de acerto e de momento |

Regra mecânica para Conquista de contagem: Degrau 1 `common`, 2 e 3 `special`, 4 `rare`, 5 `historic` (participação, consumo) ou `legendary` (acerto, momento). Para a Conquista única, a raridade vem da frequência real declarada em `real_world_frequency`, com a fonte.

**De que lado se mede a frequência (decisão do pacote do futebol, vale para todos):** pelo lado do torcedor, ou seja, quantas vezes por temporada o fato tende a acontecer **com o time do coração dele** (ou, sem time, nos eventos que um torcedor assíduo acompanha numa temporada: as corridas do ano, as lutas que ele vê). Faixas:

| Ocorrências por temporada, do lado do torcedor | Forma | Raridade da Carta única |
| --- | --- | --- |
| mais de 5 | repetível, 5 Degraus (Platina = o número por temporada) | (regra mecânica dos Degraus) |
| 2 a 5 | única | `special` |
| 0,5 a 2 | única | `rare` |
| 0,1 a 0,5 (uma vez a cada 2 a 10 temporadas) | única | `historic` |
| menos de 0,1 | única | `legendary` |

Exceção permitida e declarada em "Decisões" da pesquisa: um fato de 3 a 5 por temporada muito reconhecido (a vitória no clássico) pode ser repetível, para a Coleção ter progressão. A raridade do mercado principal (Brasil e América hispânica) prevalece quando os mercados divergem.

## 5. Arte das Cartas (prompt de geração)

Todo `art_prompt` é autossuficiente, em inglês, e segue esta ordem, em frases separadas por ponto:

1. **Cena** genérica: silhuetas ou figuras estilizadas, uniformes neutros ("plain white kit" e "plain charcoal kit", nunca cor de clube conhecida), bola e equipamento genéricos, arquibancada sem faixas. Diversidade de gênero, etnia e tipo físico; esportes femininos presentes.
2. **Enquadramento**: "vertical trading card, 3:4, subject centered, calm area at the bottom third for the title plate".
3. **Estilo**: a frase padrão do estilo escolhido. O padrão do Catálogo é o estilo **Galaxie** (galáctico, estilo E do [guia de arte](arte/guia.md), decisão do dono em 16/11 depois do lote 0): `Cosmic illustration style: deep-space backdrop with nebula gradients in indigo and violet, dense star field, soft glowing constellation lines tracing the action, bold simplified shapes with clean edges, subtle film grain, strong silhouette readable at thumbnail size.` Trocar de estilo é trocar essa frase em todas as Cartas; o vetor plano (estilo A) fica como alternativa no guia.
4. **Moldura por raridade**, frase padrão:
   - `common`: `Card frame: plain slate-grey border, matte finish.`
   - `special`: `Card frame: brushed steel-blue border with a thin inner line.`
   - `rare`: `Card frame: deep violet border with faceted corners and a faint glow.`
   - `historic`: `Card frame: warm amber border with an engraved laurel pattern and a soft outer glow.`
   - `legendary`: `Card frame: iridescent prismatic border with light rays and floating particles.`

`art_negative_prompt` padrão (pode acrescentar, nunca tirar): `logos, crests, badges, brand names, sponsor marks, readable text, letters, numbers, jersey numbers, recognizable faces, real athletes, real stadiums, club colors, national flags, watermark, blurry, extra limbs, deformed hands`.

Para a mesma Conquista com 5 Degraus, as 5 Cartas contam uma progressão (a mesma cena ganhando escala, hora do dia, multidão, intensidade), para o álbum ler como série.

## 6. Checklist das regras fixas (antes de entregar)

- [ ] Nenhuma entidade real em nome, descrição, verso, título, prompt de arte.
- [ ] Nenhum gatilho de compra, clique em loja, assinatura ou gasto.
- [ ] Nada de sorteio, pacote aleatório, chance.
- [ ] Zero aposta e odds, nem em trocadilho.
- [ ] 13+.
- [ ] Três idiomas, naturais, espanhol neutro.
- [ ] `requires_data` só com caminhos do [contrato](regras/contrato-dados.md); `proposed.` → `active: false` com motivo.
- [ ] Nenhum nome de cliente, operadora, fornecedor ou concorrente.
- [ ] Degraus 2,5 a 3x, Platina = temporada, Lendário = 2 a 3 temporadas.
- [ ] Ids únicos no padrão; `card_key` bate com id e Degrau; listas por id.
- [ ] Raridade de toda Carta justificada pela frequência real (`real_world_frequency` com fonte na Conquista).
- [ ] Todo cosmético destravado por Nível, Coleção ou Conquista.

## 7. Formato dos arquivos

Conquista (`conquistas/<esporte>.json`, lista):

```json
{
  "id": "football.moments.stoppage_time_goal",
  "sport": "football",
  "category": "moment",
  "family": "moments",
  "collection": "football.last_minute",
  "rule": { "input": "moment", "fact": "football.goal", "params": { "team": "favorite", "in_extra": true, "period": "2H" }, "presence": "at_moment" },
  "requires_data": ["event.incidents.type=goal", "event.incidents.minute", "event.incidents.extra", "event.incidents.participant_id", "fan.presence", "fan.favorite_team_id"],
  "stepped": true,
  "seasonal": true,
  "active": true,
  "inactive_reason": null,
  "real_world_frequency": "gol depois dos 90 em cerca de 20% dos jogos das ligas principais (fonte: ...)",
  "name": { "pt": "...", "es": "...", "en": "..." },
  "description": { "pt": "...", "es": "...", "en": "..." },
  "steps": [
    { "step": 1, "threshold": 1, "bonus_points": 10, "card_key": "football.moments.stoppage_time_goal.1" }
  ]
}
```

Carta (`cartas/<esporte>.json`, lista):

```json
{
  "card_key": "football.moments.stoppage_time_goal.1",
  "collection": "football.last_minute",
  "rarity": "common",
  "name": { "pt": "...", "es": "...", "en": "..." },
  "flavor": { "pt": "...", "es": "...", "en": "..." },
  "art_prompt": "...",
  "art_negative_prompt": "logos, crests, badges, brand names, sponsor marks, readable text, letters, numbers, jersey numbers, recognizable faces, real athletes, real stadiums, club colors, national flags, watermark, blurry, extra limbs, deformed hands"
}
```

Coleções (`cartas/colecoes.json`, lista): `{ "id": "football.last_minute", "sport": "football|null", "name": {pt, es, en}, "description": {pt, es, en}, "cards": ["...card_key"], "unlock": { "frame": "frame.<x>" | "background": "background.<x>" | "title": "title.<x>" } }`. Completar a Coleção destrava o cosmético apontado; nunca Pontos, nunca Carta extra. Coleção com Carta de Conquista inativa aparece na estante com a Carta em silhueta e só fecha quando a Conquista ligar; o cosmético dela espera junto.

Cosmético (`cosmeticos/{niveis,molduras,fundos,titulos}.json`, listas): `id`, `name` {pt, es, en}, `unlock` (`{ "level": 5 }`, `{ "collection": "..." }` ou `{ "achievement": "...", "step": 5 }`), `animated` (bool; se true, `animation` descreve o loop), e, para molduras e fundos, `art_prompt` e `art_negative_prompt` no padrão das Cartas.

Validar: `node docs/gamificacao/catalogo/_validar.mjs` (sem argumentos valida tudo; com um esporte, só ele).
