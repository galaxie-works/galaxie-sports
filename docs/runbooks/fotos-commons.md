# Acervo de fotos da F1 (Wikimedia Commons, licenças livres)

Fotos de pilotos e de carros (construtor numa temporada) vindas da [Wikimedia Commons](https://commons.wikimedia.org), só com licença que permite uso comercial. O esquema é o do [acervo de logos](acervo-de-logos.md):

- manifesto versionado com curadoria;
- etapas mapear → prévia → importar;
- binários no nosso storage, com a nossa nomenclatura.

A diferença é que **toda foto sai com o crédito**: na API (campo `credit`) e na demo (legenda com autor, licença e link). Por isso as fotos não viram o `logo` do participante, que aparece em lugares sem espaço para o crédito.

Prioridade do pedido (23/10/2026):

1. as temporadas do Senna (1984–1994): ele, os companheiros de equipe e os carros que pilotou;
2. os campeões;
3. os pilotos com mais corridas.

Ampliação para as lendas (escopo `lendas`, 23/10/2026): todos os campeões mundiais (título decidido; o líder da temporada em andamento não entra) e os N pilotos com mais vitórias e com mais GPs (`--limite`, padrão 20). Cada um ganha o **carro de destaque**, para o topo da página do piloto (o carro ao fundo, o retrato na frente):

- a temporada de título com mais vitórias; sem título, a de mais vitórias; sem vitória, a melhor posição no campeonato;
- empate: aproveitamento (vitórias por largada), depois posição e ano mais recente;
- a equipe é a de mais rodadas naquele ano (Moss 1958: Vanwall);
- exemplos: Senna → McLaren 1988, Schumacher → Ferrari 2004, Hamilton → Mercedes 2020.

O carro vira um alvo `car/<construtor>/<ano>`. Na busca, a foto que cita o piloto (no título ou na subcategoria da Commons, como "McLaren MP4/4 driven by Ayrton Senna") vem primeiro e vale mais nas regras.

Grid da temporada atual (escopo `grid-atual`, 24/10/2026): todo piloto que largou na última temporada do F1DB (ou na de `--ano`). O reserva só de treino livre fica de fora. Cada piloto ganha:

- retrato e fotos de ação, com as mesmas regras de licença e época;
- o **carro da equipe atual** (`car/<construtor>/<ano>`, um por equipe, sem piloto de destaque). A equipe é a de mais rodadas no ano: em 2026, Lawson fica na Racing Bulls, não na Red Bull de três corridas. É o fundo do heading de quem está no grid. Pela regra do heading, o fundo só aceita CC BY, CC0 ou domínio público; uma foto BY-SA vai só para o retrato e a galeria;
- o carro de destaque, pela mesma regra das lendas (Hamilton continua com a Mercedes 2020). Assim, mapear um escopo não desfaz o outro.

No heading de quem está no grid, o destaque da temporada atual (a foto com o próprio piloto) vem antes da primeira foto do carro da equipe, que pode ser a do companheiro.

Pilotos antigos (escopo `antigos`, 24/10/2026): quem correu entre 1950 e 1989, em três faixas — campeões, depois vencedores de GP, depois quem fez 3 temporadas ou mais —, cada um com os carros de destaque candidatos. Para a época, a Commons tem muito domínio público (Nationaal Archief, Bundesarchiv) e fotos de carros históricos em museus e eventos (Goodwood, Nürburgring Classic). Essas servem para o carro, marcadas com a temporada do carro, não com a data do arquivo. Numa ampliação, `--novos` mapeia só os alvos que ainda não estão no manifesto.

**Carros de destaque candidatos** (`highlightCandidates`, 24/10/2026). Um carro sem foto que possa ir ao fundo não deixa mais o piloto sem fundo. A importação fica com o primeiro, nesta ordem, que tenha foto compatível:

1. a temporada de título com mais vitórias;
2. as demais temporadas de título;
3. a temporada com mais vitórias (sem vitória, a melhor posição no campeonato);
4. a temporada atual ou a última da carreira, na equipe dela.

Cada candidato vira um alvo `car/<construtor>/<ano>`. No manifesto, o primeiro fica em `highlight_car` e os outros em `highlight_car.fallbacks`. A curadoria (`match: manual`) continua valendo antes de tudo.

**Chassi com outro nome na Commons** (`CHASSIS_ALIASES` em `discover.ts`): o F1DB às vezes usa o código de projeto ou o nome antigo da equipe ("Cadillac CA01" é "Cadillac MAC-26"; "Racing Bulls VCARB 03" é "RB VCARB 03"). A categoria da Commons entra antes da busca por nome.

## Licenças

| Licença | Entra? | Obrigação |
|---|---|---|
| Domínio público, CC0 | Sim | Nenhuma (o crédito sai mesmo assim) |
| CC BY (2.0, 2.5, 3.0, 4.0) | Sim | Atribuição: autor, licença com link e indicação da fonte |
| CC BY-SA (2.0, 2.5, 3.0, 4.0) | Sim | Atribuição e **compartilhar igual**: obra derivada (recorte, edição, montagem) tem de sair com a mesma licença. **Não recortamos nem editamos**: a Commons redimensiona a miniatura (1600 px) e o navegador só ajusta o tamanho |
| CC BY-NC, CC BY-ND, "fair use", GFDL sem CC, sem licença clara | **Não** | — |

- **Onde a licença é lida:** no `extmetadata` da API da Commons (`License`, `LicenseShortName`, `LicenseUrl`, `Artist`, `Credit`, `AttributionRequired`, `NonFree`), no mapeamento e de novo na importação. CC BY sem autor identificável fica de fora, porque não daria para cumprir a atribuição.
- **Direito de imagem e de marca:** a licença da foto cobre o direito autoral do fotógrafo, não o direito de imagem da pessoa nem as marcas e os patrocínios que aparecem nos carros. O uso é editorial (perfil e histórico esportivo). Nada de uso publicitário nem sugestão de endosso.

## Como escolhe (regras primeiro; IA só ordena)

1. **Identidade.** O piloto é achado no Wikidata pelo nome e **conferido** pela data de nascimento do F1DB e pela ocupação de piloto. O Wikidata dá a foto principal (P18) e a categoria da Commons (P373).
   - Com o Wikidata atrasado (`maxlag`), a identidade sai da categoria da Commons com o nome do piloto, conferida pelas categorias-mãe ("Formula One drivers…") e pelo ano em "<ano> births". A foto principal (P18) vem então pelo `Special:EntityData` do Wikidata (JSON do cache, fora do `maxlag`): item da categoria → tema principal (P301) → a pessoa, conferida pela data de nascimento completa do F1DB.
   - Carro: a categoria do chassi do F1DB ("McLaren MP4/4") e as subcategorias dela (por piloto), sem motores, miniaturas, arte e afins.
2. **Candidatas.** Entram:
   - a categoria do piloto;
   - a de retratos ("Portrait photographs of …");
   - as de cada temporada da carreira ("<piloto> in <ano>"), que dão o ano da foto.
3. **Regras eliminatórias** (`select.ts`):
   - licença aceita;
   - foto (JPEG/PNG);
   - resolução mínima de 640 × 480;
   - título sem cara de não-foto (assinatura, gráfico, estátua, túmulo, mural...);
   - época certa, entre a estreia e a última temporada (±1);
   - uma versão por foto: original ou recorte.
4. **Ordem.**
   - No mapeamento (`--mapear`, dev) valem só as regras: foto do Wikidata, retrato, temporada, época e resolução.
   - O passo do Gemini é separado (`assets-commons-ordenar`, na VPS, onde a chave funciona). O Gemini (visão) classifica as 12 melhores pelas regras em retrato, ação, carro ou outro, descarta o que não é foto real e dá a nota.
   - O Gemini **não acrescenta** nada e não identifica pessoas pelo rosto.
   - O alvo ordenado guarda o modelo e a data (`ranking` no manifesto). Nem o mapeamento por regras nem uma nova ordenação o refazem sem `--refazer`. Se o Gemini falhar, o alvo fica como estava.
5. **Escolha.**
   - Piloto: 1 retrato e até 6 de ação, no máximo 2 por temporada. O retrato é o mais recente entre os candidatos (a nota desempata): Hamilton na Ferrari, não na Mercedes.
   - Carro: até 3 fotos.

## Comandos

```bash
# 1. mapear: busca, regras, ordem e grava config/assets/commons/f1.yaml + f1.cobertura.md (não grava no banco)
pnpm --filter @galaxie/ingestor assets:commons --mapear --escopo senna      # senna | campeoes | mais-corridas | lendas [--limite 20] | grid-atual [--ano 2026] | antigos
# 2. prévia da importação (confere a licença de novo; não baixa nem grava)
pnpm --filter @galaxie/ingestor assets:commons --plan
# 3. importar: baixa a miniatura, grava no storage e liga ao piloto/construtor (idempotente)
pnpm --filter @galaxie/ingestor assets:commons
```

- **Opções:**
  - `--so driver/ayrton-senna,car/mclaren/1988`: só esses alvos;
  - `--novos`: só os alvos do escopo que ainda não estão no manifesto;
  - `--manifesto <arquivo>`;
  - `--refazer`: refaz também os alvos já ordenados pelo Gemini.
- **Ordem do Gemini** (VPS, ver "Produção"): `assets-commons-ordenar --plan` mostra os alvos a ordenar sem chamar nada. Sem `--plan`, ordena e grava o manifesto em `--saida`. Opções: `--so`, `--limite <n>`, `--refazer`; ambiente: `GEMINI_API_KEY` e `GEMINI_MODEL_VISION`.
- **Pré-requisito:** o F1DB no core e no raw, com as tabelas de equipes e chassis (`f1db:import`; a `--previa` já grava o raw).
- **Etiqueta da Wikimedia:**
  - User-Agent com o projeto e a URL do repositório, sem e-mail;
  - uma requisição por segundo;
  - `maxlag=5`, esperando quando o servidor está atrasado (no Wikidata, 3 tentativas e cai na Commons);
  - backoff em 429/5xx.
  - Uma varredura do escopo `senna` faz cerca de 330 requisições.

## Manifesto e curadoria

`config/assets/commons/f1.yaml` é versionado. Cada alvo (`driver/<id do F1DB>`, `car/<construtor>/<ano>`) tem o item do Wikidata, a categoria e as fotos, cada uma com:

- arquivo, papel (`portrait`, `action`, `car`) e temporada;
- licença com link, autor e link, crédito, `share_alike`;
- data, dimensões e quem escolheu (`rules`, `gemini`, `manual`).

| `match` | Quer dizer |
|---|---|
| `auto` | Escolhida pelas regras (e pela ordem do Gemini, se houver) |
| `manual` | Curadoria: a foto fica, mesmo que a varredura não a escolha. Para acrescentar uma foto à mão, copie um item, troque `file`, `page_url` e os campos da licença e marque `match: manual`; a importação confere a licença de novo |
| `rejected` | Curadoria: a foto sai e não volta nas próximas varreduras |

**Carro de destaque do piloto** (`highlight_car` na entrada do piloto): `target` (o alvo do carro), `season`, `reason`, `match` e, no `auto`, os outros candidatos em `fallbacks`.

- `auto`: vem da regra e é refeito a cada varredura.
- `manual`: curadoria. Troque o `target` e a `season` e marque `match: manual`; a varredura não mexe mais. Com `file`, a curadoria aponta a foto do fundo, que pode estar no alvo do carro ou na galeria do piloto (Hamilton: a do GP da China de 2026). A `season` é a do carro, não a da foto: o W196 do Fangio fotografado num museu em 2022 fica com 1955.

Na importação, a primeira foto do primeiro candidato que não foi rejeitada **e não é CC BY-SA** vira também vínculo do piloto, com o papel `highlight_car` e a temporada (`highlightPhoto`). O motivo: o heading recorta a foto no navegador (cover), o que é uma adaptação, e BY-SA pediria a mesma licença na obra derivada. Se o carro não tiver foto compatível, o piloto fica sem destaque e o heading usa a cor da equipe: nunca uma foto ruim. As fotos BY-SA continuam na galeria, inteiras e com crédito. Um teste recusa curadoria (`match: manual`) de carro sem foto compatível.

`config/assets/commons/f1.cobertura.md` mostra, por alvo, as fotos e licenças e, na última varredura, candidatas, aceitas e os motivos de recusa mais comuns.

## Onde aparece

- **API:**
  - `GET /v1/teams/{id}/photos` (`role`, `season`): fotos com `credit` (autor, licença, links e `text`, a linha pronta);
  - `GET /v1/teams/{id}/career`: o `portrait`, o `highlight` (carro de destaque: `season` e `car`) e o `car` de cada temporada, com o mesmo crédito.
- **Demo:**
  - galeria e retrato na página do piloto ou da equipe;
  - foto do carro na tabela de temporadas da carreira;
  - "o carro do vencedor" na página do GP.
  - Sempre com a legenda de crédito.
- **Banco:**
  - `core.asset` (`origin = commons`, `acervo = commons-f1`, `source_url = commons://<arquivo>`);
  - `core.asset_credit`: autor, licença, página, data e dimensões originais;
  - `core.participant_photo`: participante, papel, temporada e ordem.
  - Storage: `commons/f1/{drivers|cars}/<id do participante>.<sha256[0:12]>.{jpg|png}`.

## Produção (VPS)

Depois do deploy (migration `0027_fotos_commons`) e com o F1DB já carregado. Os passos com IA usam o serviço `agents`, que é a mesma imagem do ingestor com as chaves de IA. O volume `galaxie-commons` guarda o manifesto ordenado e as biografias entre uma execução e outra.

```bash
ssh root@145.223.94.149
cd /docker/galaxie-sports
# 0. volume de trabalho do usuário do container (só na primeira vez)
docker compose run --rm --no-deps --user root -v galaxie-commons:/data/commons --entrypoint chown agents \
  -R 1000:1000 /data/commons
# 1. o raw do F1DB com as tabelas de equipes e chassis (prévia: grava só o raw)
docker compose run --rm --no-deps -v galaxie-f1db:/data/f1db -e F1DB_DIR=/data/f1db \
  -e NODE_OPTIONS=--max-old-space-size=384 ingestor node dist/cli/f1db-import.js --previa
# 2. ordem do Gemini: prévia (alvos a ordenar, sem chamar nada) e execução (idempotente; continua de onde parou)
docker compose run --rm --no-deps -v galaxie-commons:/data/commons agents \
  node dist/cli/assets-commons-ordenar.js --plan --saida /data/commons/f1.yaml
docker compose run --rm --no-deps -v galaxie-commons:/data/commons agents \
  node dist/cli/assets-commons-ordenar.js --saida /data/commons/f1.yaml
# 3. prévia das fotos do manifesto ordenado (confere licenças; não grava)
docker compose run --rm --no-deps -v galaxie-commons:/data/commons ingestor \
  node dist/cli/assets-commons.js --plan --manifesto /data/commons/f1.yaml
# 4. importa (baixa da Commons, grava no storage e liga aos pilotos/construtores; idempotente)
docker compose run --rm --no-deps -v galaxie-commons:/data/commons ingestor \
  node dist/cli/assets-commons.js --manifesto /data/commons/f1.yaml
# 5. limpa o cache de respostas da API (mesmo passo do deploy)
for p in 'gs:cache:*' 'gs:tag:*'; do docker compose exec -T valkey sh -c "valkey-cli --scan --pattern '$p' | xargs -r -n 200 valkey-cli del >/dev/null"; done
# 6. traz o manifesto ordenado para o repositório (PR), para o git ficar igual à produção
docker compose run --rm --no-deps -v galaxie-commons:/data/commons --entrypoint cat agents /data/commons/f1.yaml > /tmp/f1.yaml
```

- **Sem o passo 2**, os passos 3 e 4 com o manifesto do repositório (sem `--manifesto`) importam a escolha só pelas regras.
- **Reverter:** `delete from core.participant_photo where asset_id in (select id from core.asset where origin = 'commons')`. Os assets ficam; reimportar religa.

### Biografias (Gemini com fontes)

1. **Na VPS, gerar as propostas.** O passo não grava no banco nem no YAML. Piloto com proposta aceita não é pesquisado de novo; para pesquisar de novo, use `--refazer`.

   ```bash
   docker compose run --rm --no-deps -e AI_PROVIDER=gemini -v galaxie-commons:/data/commons agents \
     node ../ai-agents/dist/cli/f1-bio.js --plan --saida /data/commons/f1bio
   docker compose run --rm --no-deps -e AI_PROVIDER=gemini -v galaxie-commons:/data/commons agents \
     node ../ai-agents/dist/cli/f1-bio.js --saida /data/commons/f1bio
   docker compose run --rm --no-deps -v galaxie-commons:/data/commons --entrypoint cat agents \
     /data/commons/f1bio/proposals.json > /tmp/f1bio-proposals.json
   ```
2. **No dev, aplicar e abrir o PR.** Os perfis entram como `draft` em `data/knowledge/formula-1/participants/drivers.yaml`. Perfil aprovado nunca é sobrescrito, e aplicar de novo não muda nada.

   ```bash
   pnpm --filter @galaxie/ai-agents f1:bio --aplicar f1bio-proposals.json --plan
   pnpm --filter @galaxie/ai-agents f1:bio --aplicar f1bio-proposals.json
   ```
3. **Depois do merge e do deploy,** o seed leva os perfis ao painel de revisão (Ajustes → Revisão semântica) para aprovação.

Regra das biografias: toda frase precisa de uma fonte vinda da busca do Gemini (grounding). Frase sem fonte, ou com fonte que não veio da busca, é descartada, e o relatório (`report.md`) mostra o motivo.

## Créditos

Cada foto tem o próprio autor e a própria licença, no manifesto, no `core.asset_credit` e em toda resposta da API. A fonte é sempre a Wikimedia Commons, com o link da página do arquivo.
