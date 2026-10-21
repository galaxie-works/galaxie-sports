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
├── competitions/*.yaml             # apelidos e semântica de competições (ex.: "Glória Eterna" = Libertadores)
├── copy/<locale>.yaml              # biblioteca de microcopy por mercado (pt-BR e 7 variantes de espanhol)
└── schemas/*.schema.json           # JSON Schemas (draft-07) de cada tipo de arquivo
```

## Validação, seed e resolução de IDs

| Comando | O que faz |
|---|---|
| `pnpm knowledge:validate` | JSON Schema + regras cruzadas: slugs únicos, `team_id`/`api_sports_league_id` únicos, clássicos com times existentes, rivais apontando para times/clássicos existentes (avisa quando a rivalidade não é recíproca ou a intensidade diverge da do clássico), `sources` obrigatórias, locales permitidos, `review_status` válido, heurística contra letra de hino/canção e regras de `copy_permission` nos templates. Roda no CI; erro = merge bloqueado. |
| `pnpm db:seed:semantic` | Carrega tudo em `semantic.*` (idempotente; remove o que saiu do YAML), liga perfis a `core.participant`/`core.competition` via `provider_map`, recalcula `core.event.derby_id` e registra `semantic.load_run` com o SHA do Git. |
| `pnpm resolve:ids` | Casa slugs com times da api-sports usando só o banco local (raw `/teams?country=`, `/fixtures`, `/leagues` e `core.participant`). `--write` grava no YAML apenas os casos resolvidos sem ambiguidade (só o valor muda; comentários e estilo ficam); `--apply-db` grava `core.provider_map` e `team_profile.participant_id` quando o participante existe; `--json` salva o relatório. |

Os editores com suporte a YAML Language Server podem usar os schemas com `# yaml-language-server: $schema=../../schemas/teams.schema.json`.

## `teams/<iso2>.yaml`

```yaml
schema_version: 1
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
      name: Allianz Parque
      nicknames: [Arena]
      city: São Paulo
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
| `copy_hints.<locale>.nicknames` | times e seleções | Apelidos preferidos naquele mercado (ex.: pt-BR "Merengue", es "Merengues") |
| `country` | `national-teams.yaml` | ISO2 da seleção |
| `world_cup_titles` | `national-teams.yaml` | Número de títulos mundiais (somente se verificado) |

Locales válidos em `copy_hints`: `pt-BR`, `es-AR`, `es-MX`, `es-CO`, `es-CL`, `es-PE`, `es-UY`, `es-EC`, `es-PY`, `es-BO`, `es-VE` e `es` (genérico, só para clubes/seleções fora da América Latina).

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

## Regras editoriais (guardrails)

1. **Fatos verificáveis** e com `sources`. Na dúvida, `null` ou omita — nunca invente data, ID ou apelido.
2. **Sem conteúdo ofensivo**: nada de cantos discriminatórios, violência, tragédias como provocação, apelidos pejorativos usados como ofensa. Apelidos que nasceram pejorativos e foram adotados pela torcida (ex.: "Porco") são permitidos com essa nota em `identity`.
3. **Direitos autorais**: nunca transcrever letras de hinos ou músicas; apenas gritos curtos de domínio público/slogans oficiais.
4. **Rivalidade em copy** só é usada pela API quando o usuário declarou explicitamente o rival (ver `docs/06-semantica-e-conteudo.md`).
5. `review_status: draft` até revisão editorial humana; a API expõe o status para o cliente decidir se exibe.
