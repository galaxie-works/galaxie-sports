# Base de Conhecimento Semântico — Schema v1

A base semântica é **pré-cadastrada** (arquivos versionados em YAML, carregados no banco pelo seed) e não depende de consulta em tempo real. Ela dá "alma" aos dados frios da api-sports: nomes de clássicos, apelidos, gritos de torcida, mascotes, rivalidades e dicas de linguagem por mercado.

## Estrutura de pastas

```
data/knowledge/
├── SCHEMA.md                       # este arquivo
├── football/
│   ├── teams/<iso2>.yaml           # um arquivo por país (br, ar, uy, cl, co, pe, ec, py, bo, ve, mx, gb-eng, es, it, de, fr, pt, nl...)
│   ├── national-teams.yaml         # seleções
│   └── derbies/<region>.yaml       # clássicos/dérbis (br, south-america, mexico, europe, international)
├── basketball/                     # NBA, NBB e Liga Nacional argentina (a NBA fica aqui, não em "nba")
│   ├── teams/<iso2>.yaml           # us, br, ar
│   └── derbies/<region>.yaml       # nba, br, ar
├── volleyball/
│   ├── teams/br.yaml               # Superliga masculina e feminina (equipes do mesmo clube = itens separados)
│   └── derbies/br.yaml
├── formula-1/
│   └── participants/<arquivo>.yaml # constructors.yaml (kind: constructor), drivers.yaml (kind: driver)
├── competitions/*.yaml             # apelidos e semântica de competições (ex.: "Glória Eterna" = Libertadores)
├── copy/<locale>.yaml              # biblioteca de microcopy por mercado (pt-BR e 7 variantes de espanhol)
├── glossary/<locale>.yaml          # glossário esportivo por mercado (GET /v1/glossary)
├── i18n/<locale>.yaml              # textos livres traduzidos (pt-BR, es neutro e es-XX) — ver abaixo
└── schemas/*.schema.json           # JSON Schemas (draft-07) de cada tipo de arquivo
```

## Validação, seed e resolução de IDs

| Comando | O que faz |
|---|---|
| `pnpm knowledge:validate` | JSON Schema + regras cruzadas: slugs únicos, `team_id`/`api_sports_league_id` únicos, clássicos com times existentes, rivais apontando para times/clássicos existentes (avisa quando a rivalidade não é recíproca ou a intensidade diverge da do clássico), `sources` obrigatórias, locales permitidos, `review_status` válido, traduções de `i18n/` (slug existente, sem repetir o idioma-base, mesmos fatos do original) e idioma dos textos livres, heurística contra letra de hino/canção, nomes anteriores e `api_sports_venue_id` dos estádios e regras de `copy_permission` nos templates. Roda no CI; erro = merge bloqueado. |
| `pnpm db:seed:semantic` | Carrega tudo em `semantic.*` (idempotente; remove o que saiu do YAML), liga perfis a `core.participant`/`core.competition` via `provider_map`, liga os estádios do YAML a `core.venue` (nome curado, ver abaixo), recalcula `core.event.derby_id`, grava o catálogo da revisão (`semantic.review_item`) aplicando as decisões do painel de revisão que ainda valem (o status aprovado no painel vence o do YAML enquanto o conteúdo não mudar — [docs/06 §2.1](../../docs/06-semantica-e-conteudo.md#21-revisão-pelo-painel-ajustes--revisão)) e registra `semantic.load_run` com o SHA do Git. Depois, `pnpm --filter @galaxie/ingestor events:importance` recalcula a importância dos eventos já gravados (os novos já saem certos do upsert). |
| `pnpm knowledge:i18n` | Cobertura das traduções de `i18n/` por locale: quantos times e clássicos com texto em outro idioma já têm tradução (`--locale es`, `--arquivo football/teams/br.yaml`, `--faltando` lista o que falta). |
| `pnpm resolve:ids` | Casa slugs com times da api-sports usando só o banco local (raw `/teams?country=`, `/fixtures`, `/leagues` e `core.participant`). `--write` grava no YAML apenas os casos resolvidos sem ambiguidade (só o valor muda; comentários e estilo ficam); `--apply-db` grava `core.provider_map` e `team_profile.participant_id` quando o participante existe; `--json` salva o relatório. |

Os editores com suporte a YAML Language Server podem usar os schemas com `# yaml-language-server: $schema=../../schemas/teams.schema.json`.

## `teams/<iso2>.yaml`

```yaml
schema_version: 1
text_locale: pt-BR             # opcional: idioma dos textos livres (identity, mascot, colors, fans); padrão pt-BR; nos países hispânicos a voz do país (es-AR, es-UY, es-MX…)
country: BR                    # ISO 3166-1 alpha-2 (Inglaterra = GB-ENG)
teams:
  - slug: palmeiras            # kebab-case, único globalmente; prefixe com país se houver ambiguidade (ex.: nacional-uy)
    names:
      official: Sociedade Esportiva Palmeiras
      short: Palmeiras
      abbreviation: PAL        # sigla usual em placares
    api_sports:
      team_id: 121             # SOMENTE se verificado em fonte; senão null (resolvido no bootstrap por name+country)
      match: { name: "Palmeiras", country: "Brazil" }
    founded: 1914-08-26        # ISO; null se incerto
    city: São Paulo
    region: SP                 # estado/província quando relevante
    colors: [verde, branco]
    nicknames: [Verdão, Porco, Palestra]         # apelidos do clube
    fans:
      demonym: palmeirense                       # como o torcedor é chamado
      group_nicknames: [Porcada]                 # apelidos coletivos da torcida (opcional)
    mascot: Porco                                # mascote principal (opcional)
    rallying_cries: ["Avanti, Palestra!"]        # gritos/slogans curtos e públicos — NUNCA letra completa de hino/canção
    stadium:
      name: Nubank Parque                        # nome ATUAL (vence o do fornecedor em toda a API)
      nicknames: [Arena]
      former_names:                              # opcional: nomes anteriores (naming rights), com fonte em sources
        - { name: Allianz Parque, until: 2026-05-03 }   # until = último dia em que o nome valeu
      city: São Paulo
      api_sports_venue_id: 258                   # opcional: SOMENTE se verificado; sem ele o seed casa por nome + cidade
    rivals:                                      # slugs de outros times
      - { team: corinthians, derby: derby-paulista, intensity: 5 }
      - { team: sao-paulo, derby: choque-rei, intensity: 4 }
    identity:                                    # fatos curtos de identidade para cards/IA
      - "Fundado por imigrantes italianos como Palestra Itália."
    copy_hints:                                  # sugestões de microcopy por locale (tom torcedor, sem ofensa)
      pt-BR:
        cheer: ["Avanti, Palestra!", "Vai, Verdão!"]
    sources: ["https://..."]                     # URLs consultadas
    review_status: draft                         # draft | reviewed | approved
```

### Campos opcionais aceitos

| Campo | Onde | Uso |
|---|---|---|
| `labels: { pt-BR, es, en }` | times e seleções | Nome como é usado em cada mercado (ex.: "Bayern de Munique" / "Bayern Múnich") |
| `stadium.former_names: [{ name, until }]` | times | Nomes anteriores do estádio; `until` (ISO) = último dia do nome. Erro se repetir o nome atual ou outro anterior; aviso se também estiver em `nicknames` |
| `stadium.api_sports_venue_id` | times (só futebol) | ID do estádio na api-sports; erro se o mesmo ID tiver nomes diferentes em dois times (estádio compartilhado com o mesmo nome é ok) |
| `copy_hints.<locale>.nicknames` | times e seleções | Apelidos preferidos naquele mercado (ex.: pt-BR "Merengue", es "Merengues") |
| `country` | `national-teams.yaml` | ISO2 da seleção |
| `world_cup_titles` | `national-teams.yaml` | Número de títulos mundiais (somente se verificado) |

Locales válidos em `copy_hints`: `pt-BR`, `es-AR`, `es-MX`, `es-CO`, `es-CL`, `es-PE`, `es-UY`, `es-EC`, `es-PY`, `es-BO`, `es-VE` e `es` (genérico, só para clubes/seleções fora da América Latina).

### Estádios: nome curado × fornecedor

O `stadium` do time é a **curadoria** do nome do estádio. No `pnpm db:seed:semantic`, cada estádio é ligado às linhas de `core.venue` pelo `api_sports_venue_id` ou, sem ele, entre o estádio-sede do time e os estádios dos jogos em que foi mandante, por nome (`name`, `nicknames` ou `former_names` × nome do fornecedor, inclusive o trecho entre parênteses, e nomes anteriores derivados dos jogos) e cidade. A linha ganha `core.venue.curated` sem perder o nome cru (`core.venue.name`); quem sai do YAML perde a curadoria. A API, a demo e os agentes de IA mostram o nome curado — também nos jogos anteriores à troca (os antigos ficam em `former_names` do `GET /v1/venues/{id}`). Datas de troca sem fonte não entram: deixe `# TODO` no YAML.

## Outros esportes (issue #44)

As pastas de primeiro nível são os esportes do `core.sport` (`football`, `basketball`, `volleyball`, `formula-1`, `handball`, `hockey`, `rugby`, `baseball`, `american-football`, `afl`, `mma`); dentro delas valem os mesmos formatos (`teams/<iso2>.yaml`, `derbies/<region>.yaml`). Regras adicionais:

- **Slugs com prefixo do esporte** (`basketball-flamengo`, `volleyball-minas-feminino`, `f1-ferrari`) — os slugs são globais e o do futebol (`flamengo`) já existe.
- **Clássicos e rivais só dentro do mesmo esporte** (erros `derby-cross-sport` e `rival-cross-sport`).
- **`api_sports.team_id: null` fora do futebol** (erro `provider-id-sport`): o seed e o `resolve:ids` só vinculam perfis a `core.participant` no futebol; nos demais o vínculo fica para quando o resolvedor for multiesporte. `match.name`/`match.country` registram como a api-sports provavelmente escreve o nome.
- **`<esporte>/participants/<arquivo>.yaml`** para quem não é clube de um país só (pilotos, equipes da F1, lutadores):

```yaml
schema_version: 1
kind: driver                 # driver | constructor | fighter | athlete → semantic.team_profile.kind
participants:
  - slug: f1-sergio-perez    # mesmo formato de um time, com `country` obrigatório
    names: { official: Sergio Michel Pérez Mendoza, short: Sergio Pérez, abbreviation: PER }
    api_sports: { team_id: null, match: { name: "Sergio Perez", country: "Mexico" } }
    country: MX
    nicknames: [Checo]
    sources: ["https://..."]
    review_status: draft
```

## `derbies/<region>.yaml`

```yaml
schema_version: 1
region: br
derbies:
  - slug: choque-rei
    name: Choque-Rei
    aliases: [San-Pal, Choque Rei]
    labels: { pt-BR: Choque-Rei, es: Choque-Rei, en: Choque-Rei }
    teams: [palmeiras, sao-paulo]               # exatamente 2 slugs (ordem alfabética não exigida)
    scope: state                                 # city | state | national | continental | international
    intensity: 4                                 # 1–5 (5 = maior rivalidade do país)
    first_match: 1930-03-02                      # ISO; null se incerto
    origin: "Nome atribuído ao jornalista Thomaz Mazzoni."   # 1 frase, fato verificável
    trivia:                                      # 0–3 fatos curtos, verificáveis
      - "..."
    sources: ["https://..."]
    review_status: draft
```

## `competitions/football.yaml`

```yaml
schema_version: 1
competitions:
  - slug: libertadores
    api_sports_league_id: 13
    labels: { pt-BR: Libertadores, es: Libertadores, en: Copa Libertadores }
    nicknames: { pt-BR: [Glória Eterna, Liberta], es: [La Gloria Eterna, La Copa] }
    trophy_nickname: null
    sources: ["https://..."]                     # pelo menos uma URL
    review_status: draft                         # opcional (padrão draft)
```

## `copy/<locale>.yaml`

Microcopy localizada **pela intenção** (docs/06 §4), um arquivo por mercado: `pt-BR`, `es-AR`, `es-MX`, `es-CO`, `es-CL`, `es-PE`, `es-UY`, `es-EC`.

```yaml
schema_version: 1
locale: pt-BR
sport: football
templates:
  - key: rivalry-3                 # único no locale; no banco vira "pt-BR.rivalry-3"
    intent: rivalry                # inform | anticipate | cheer | rivalry | urgency | decisive
    tone: 3                        # 1 informativo · 2 próximo · 3 torcedor · 4 alta energia
    affinity_type: rival           # opcional: heart | support | sympathy | rival | interest
    affinity_source: explicit      # opcional: explicit | inferred
    momentum: null                 # opcional: D-3+, D-2, D-1, today, T-60, T-30, T-10, starting, live
    competition_context: null      # opcional: regular, derby, playoff, knockout, semifinal, final, title, lead, relegation
    template: "{rival} em campo hoje. Dia de secar!"   # placeholders: {team} {nickname} {rival} {minutes}
    confidence: HIGH               # HIGH | MEDIUM | EXPERIMENTAL
    review_status: draft
```

Campos opcionais restringem o template: `null` vale para qualquer valor do pedido. A escolha em tempo de execução é feita por `selectCopy` (`packages/knowledge`), que aplica o `copy_permission`: afinidade inferida recebe só `inform` tom 1; rivalidade só com rival declarado. Evite artigo antes de `{team}`/`{rival}` (o gênero muda por clube).

## `glossary/<locale>.yaml`

Termos esportivos **positivos** de cada mercado (docs/06 §4.3), servidos por `GET /v1/glossary?locale=`.

```yaml
schema_version: 1
locale: pt-BR
sport: football                    # football | multi
terms:
  - key: secar                     # único no locale
    term: "secar"
    meaning: "Torcer de brincadeira para que o rival não tenha sucesso no jogo dele."   # uma frase, no idioma do mercado
    example: "Dia de secar o rival!"                 # opcional, curto e sem ofensa
    category: rivalry              # support | rivalry | fans | match | competition
    copy_intents: [rivalry]        # opcional: intenções de copy em que o termo cabe
    requires: declared_rival       # opcional: declared_rival | declared_affinity (copy_permission)
    note: "Uso lúdico; só para rival declarado."     # opcional
    sources: ["https://..."]       # dicionário ou referência
    review_status: draft
```

Regras do validador: termo de rivalidade (`category: rivalry` ou `copy_intents` com `rivalry`) exige `requires: declared_rival` (erro); termo de torcida (`cheer`) sem `requires` gera aviso; chave única por locale; `locale` igual ao nome do arquivo; heurística de letra em `meaning`, `note` e `example`.

## `i18n/<locale>.yaml`

Tradução dos **textos livres** para um mercado (docs/06 §3.3). Cada arquivo de times, seleções, participantes ou clássicos escreve esses textos num idioma só, declarado no topo:

```yaml
schema_version: 1
text_locale: es-AR     # idioma de identity, mascot, colors e fans (ou origin e trivia); padrão pt-BR
country: AR
teams: [...]
```

As traduções ficam em um arquivo por locale (`pt-BR`, `es` e `es-AR`, `es-MX`, `es-CO`, `es-CL`, `es-PE`, `es-UY`, `es-EC`, `es-PY`, `es-BO`, `es-VE`):

```yaml
schema_version: 1
locale: es-AR
teams:
  - slug: palmeiras                      # time, seleção ou participante existente
    identity:                            # os MESMOS fatos do original, na mesma ordem
      - "Fundado por inmigrantes italianos como Palestra Italia; adoptó el nombre Palmeiras en 1942."
      - "El apodo Porco (chancho, en portugués) nació como una cargada de los rivales y la hinchada lo adoptó con orgullo."
      - "En 2026 la cancha pasó a llamarse Nubank Parque (antes Allianz Parque) por un contrato de naming rights."
    mascot: Porco (chancho)              # opcional
    colors: [verde, blanco]              # opcional
    fans: { demonym: palmeirense }       # opcional (demonym, group_nicknames)
    note: "Porco = chancho; cargada e hinchada no lugar de burla e afición."   # opcional, só editorial
    review_status: draft
derbies:
  - slug: classico-do-povo
    origin: "Reúne a las dos hinchadas más grandes de Brasil."   # e/ou trivia (até 3)
    review_status: draft
```

- **Clube hispânico fala como o seu país.** O YAML do clube já vem na voz do país (`es-AR`, `es-UY`, `es-CL`…), com os apelidos que a torcida usa, e esse texto vale para todo mercado em espanhol — por isso não existe `es` neutro para ele (erro `i18n-redundant`). Os gritos ficam em `copy_hints.<locale do clube>.cheer` e também servem aos outros mercados em espanhol. Em `football/derbies/south-america.yaml`, que mistura países, cada clássico declara a voz em `text_locale` no próprio item.
- **Campo a campo.** A API escolhe cada campo pela cadeia `es-XX → es → original`; uma variante só precisa trazer o que muda (o `es-AR` acima deixa as cores no `es`).
- **`es` neutro primeiro.** Todo texto em português ganha a versão `es` (vocabulário pan-hispânico: *afición*, *estadio*, *entrenador*); `es-XX` só quando a palavra muda no país — torcida (*hinchada*, *barra*, *porra*), estádio (*cancha*), o bicho ou objeto de um apelido (*chancho*, *puerco*, *marrano*), gíria (*cargada*, *talla*, *vacilón*). Fato puro (data, fundador, título) fica só no `es`. Gritos em segunda pessoa (voseo, *le voy al*) vão em `copy_hints.<locale>.cheer` do próprio time.
- **Tradução não cria fato.** Glosas entre parênteses só explicam o apelido; o validador avisa quando a quantidade de fatos ou de curiosidades difere da do original (`i18n-drift`).
- **`review_status` próprio**, nunca acima do original (`i18n-review`): a tradução entra `draft` e um revisor nativo do mercado a promove. A API só serve a tradução que atinge o piso editorial; abaixo dele o campo cai no próximo da cadeia.

Regras do validador: `locale` igual ao nome do arquivo; slug de time/clássico existente (`i18n-unknown-slug`); tradução no mesmo idioma do original é erro (`i18n-redundant`: edite o arquivo de origem); tradução repetida no mesmo arquivo; heurística de letra; e heurística de idioma (`text-language`) também nos textos originais — português num arquivo `text_locale: es` ou numa tradução `es-*` vira aviso.

`pnpm knowledge:i18n` mostra a cobertura por locale (`--locale es`, `--arquivo football/teams/br.yaml`, `--faltando` para listar o que ainda cai no original).

## Regras editoriais (guardrails)

1. **Fatos verificáveis** e com `sources`. Na dúvida, `null` ou omita — nunca invente data, ID ou apelido.
2. **Sem conteúdo ofensivo**: nada de cantos discriminatórios, violência, tragédias como provocação, apelidos pejorativos usados como ofensa. Apelidos que nasceram pejorativos e foram adotados pela torcida (ex.: "Porco") são permitidos com essa nota em `identity`.
3. **Direitos autorais**: nunca transcrever letras de hinos ou músicas; apenas gritos curtos de domínio público/slogans oficiais.
4. **Rivalidade em copy** só é usada pela API quando o usuário declarou explicitamente o rival (ver `docs/06-semantica-e-conteudo.md`).
5. `review_status: draft` até revisão editorial; a API expõe o status para o cliente decidir se exibe. A primeira promoção a `approved` (out/2026) foi feita por revisores de IA no papel de editores nativos de cada mercado — critério e registro em docs/06 §2.
