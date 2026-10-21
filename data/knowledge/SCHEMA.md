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
└── competitions/football.yaml      # apelidos e semântica de competições (ex.: "Glória Eterna" = Libertadores)
```

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
    sources: []
```

## Regras editoriais (guardrails)

1. **Fatos verificáveis** e com `sources`. Na dúvida, `null` ou omita — nunca invente data, ID ou apelido.
2. **Sem conteúdo ofensivo**: nada de cantos discriminatórios, violência, tragédias como provocação, apelidos pejorativos usados como ofensa. Apelidos que nasceram pejorativos e foram adotados pela torcida (ex.: "Porco") são permitidos com essa nota em `identity`.
3. **Direitos autorais**: nunca transcrever letras de hinos ou músicas; apenas gritos curtos de domínio público/slogans oficiais.
4. **Rivalidade em copy** só é usada pela API quando o usuário declarou explicitamente o rival (ver `docs/06-semantica-e-conteudo.md`).
5. `review_status: draft` até revisão editorial humana; a API expõe o status para o cliente decidir se exibe.
