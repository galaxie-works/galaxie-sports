# Acervo customizado de logos

Camada opcional de escudos e logos em alta qualidade por cima dos logos do fornecedor, pensada para a TV. Ela serve a qualquer acervo **licenciado**, por exemplo um pacote de agência ou de fornecedor. A flag **`ASSETS_CUSTOM_LOGOS`** (painel Ajustes → Operação → Logos, padrão `off`) liga e desliga o acervo sem deploy.

- **Ligada:** a API mostra o logo do acervo em tudo que tiver mapeamento (time, evento, timeline, escalação, estatísticas, busca, home/explorar, navegação, classificação, contexto da competição, elenco e perfil de pessoa, H2H, campanhas).
- **Desligada:** volta na hora para o logo do fornecedor. Nada é apagado.
- **Fora da troca:** o espelho `/mirror` continua byte a byte o da api-sports.

## Como funciona

| Peça | Onde |
| --- | --- |
| Origem por asset | `core.asset.origin` (`provider` \| `acervo`) e `core.asset.acervo` (id do acervo). `source_url` = `acervo://<id>/<arquivo>`, rastro interno nunca publicado. `storage_key` = `acervo/football/{teams|leagues}/<id do nosso time ou competição>.<sha256[0:12]>.{svg|png}` (migration `0023_acervo_logos`) |
| Nome publicado | O storage, o CDN e as URLs da API só usam a nossa nomenclatura (tipo, id e hash), sem o nome do acervo, da fonte ou do arquivo do pacote. A origem fica só no que é interno: `core.asset.origin`/`acervo`, o manifesto e o relatório. O hash no nome troca a URL quando o logo muda |
| Vínculo | `core.participant.custom_logo_asset_id` e `core.competition.custom_logo_asset_id`, ao lado do `logo_asset_id` do fornecedor, que nunca é tocado |
| Flag | `packages/runtime-config/src/registry.ts` (seção `assets`). A API relê a cada 15 s, com precedência banco > env > padrão (`apps/api/src/assets/custom-logos.ts`) |
| Cache | A versão da flag (valor + instante da última mudança no painel) entra na chave de todas as respostas (`VariantResponseCache`). Trocar a flag passa a ler chaves novas na hora, sem purge e sem servir resposta velha. Uma resposta montada durante a troca cai numa chave que ninguém mais usa |
| Contrato | `logo_source` (`provider` \| `acervo` \| `null`), `logo_formats` (`{ svg, png, webp }`, null fora do acervo) e `logo_sizes` (`{ 64, 128, 256, 512 }`, cada um `{ png, webp }`) em `Team` (`/v1/teams/{id}`) e `Competition` (`/v1/competitions/{id}`) |
| Formatos | `core.asset.variants` (migration `0062_acervo_formatos`): SVG, maior PNG e maior WebP do mesmo escudo, cada um no storage como `acervo/football/{teams\|leagues}/<id>.<sha256[0:12]>.{svg\|png\|webp}`. `logo` continua sendo um só (SVG, senão PNG, senão WebP) |
| Tamanhos | `variants.sizes`: do PNG do pacote, a importação gera PNG e WebP em 64, 128 e 256 px (`sharp`, encaixe sem corte com sobra transparente; não amplia PNG menor). O 512 é o próprio PNG/WebP do pacote. Reimportar regera e só grava o que mudou |
| Cores do time | Saem do escudo efetivo. A paleta do logo do acervo é calculada na importação: do maior PNG do pacote quando há, senão das cores de preenchimento do SVG (`svg-palette.ts`) |
| "Sem logo" (#178) | Time cujo logo do fornecedor era genérico e foi desligado (`logo_asset_id` nulo) ganha o do acervo com a flag ligada: o `coalesce` preenche o buraco |

## Pacote (fora do git)

Os binários nunca entram no repositório. A pasta do pacote segue este layout:

```
<pasta>/acervo.yaml                         id, nome, autor, licença, revisão (+ nomes opcionais)
<pasta>/teams/<país>/<slug>.svg|png|webp    clubes e seleções
<pasta>/competitions/<país|world>/<slug>.svg|png|webp
```

- `<país>` é o código (`br`, `gb-eng`) ou o nome (`brazil`, `england`). `world` vale para torneios internacionais.
- Variantes do mesmo logo (`x.svg`, `x.png`, `x@4x.png`, `x.webp`) viram um item só. O SVG é o servido, ou o maior PNG, ou o maior WebP. A paleta sai do maior PNG. Os três formatos vão para `formats` no manifesto e são publicados em `logo_formats`.
- `acervo.yaml`:

```yaml
acervo:
  id: agencia-x # [a-z0-9-]; vai para a storage_key e para core.asset.acervo
  name: Pacote de escudos da Agência X
  author: Agência X # crédito publicado abaixo
  license: Contrato 2026-123 (uso em TV e streaming na América Latina)
  url: https://…
  revision: '2026-10' # versão, tag ou commit de origem
names: # opcional: nome de exibição por chave (senão, o slug do arquivo)
  teams/br/sao-paulo: São Paulo
```

## Comandos

```bash
# 1. mapear: varre o pacote, casa com o banco e grava manifesto + relatório (não grava no banco nem no storage)
pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir> --mapear
# 2. prévia da importação
pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir> --plan
# 3. importar (idempotente: rodar de novo não regrava nada)
pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir>
# desligar um acervo sem apagar (os assets ficam; reimportar religa)
pnpm --filter @galaxie/ingestor assets:acervo --acervo <id> --desvincular [--plan]
```

- Opções: `--lote N` (padrão 50 logos por lote, para não pesar na memória), `--verbose` e `--manifesto <arquivo>`.
- A importação fica registrada em `ops.job_run` (`assets:acervo`).
- Zero chamadas ao fornecedor.

## Manifesto e curadoria

`config/assets/acervo/<id>.yaml` é versionado e guarda o rastro de cada logo: chave, arquivo, país, nome, `sha256`, `target_id` (time ou competição), `match` e confiança. A revisão do pacote fica em `acervo.revision`.

O mapeamento é conservador:

- casa só no mesmo país;
- usa o normalizador da base semântica (acentos, "FC", "CF", "Club"...) e os nomes da base semântica (`semantic.team_profile`: oficial, curto, labels);
- liga sozinho só com confiança ≥ 0,9 e folga de 0,1 sobre o segundo candidato;
- no Brasil, o sufixo de estado ("America RN", "Flamengo SE") desempata homônimos, e um logo sem sufixo fica com o clube sem sufixo;
- base, feminino e time B só casam com logo que também seja de base, feminino ou B;
- apelido sozinho só sugere candidato;
- dois logos no mesmo alvo viram ambíguos.

Valores de `match`:

| `match` | Quer dizer |
| --- | --- |
| `auto` | Ligado pelo mapeamento |
| `ambiguous` | Candidatos próximos: fica sem vínculo e aparece no relatório com os candidatos |
| `unmatched` | Nenhum candidato razoável no país |
| `manual` | Curadoria: escreva `target_id` e `match: manual`. A próxima varredura mantém |
| (apelidos) | Curadoria por nome: `aliases: ["Sheffield Utd"]` com o nome do time ou da competição no cadastro. A próxima varredura tenta cada apelido com as mesmas regras do nome do arquivo e os mantém. Um apelido que não existe no cadastro não liga nada |
| `rejected` | Curadoria: não tem par. A próxima varredura mantém |
| `duplicate` | Outro logo do pacote já cobre o mesmo time: vale o da liga nacional |

`config/assets/acervo/<id>.cobertura.md` traz, por país, quantos logos foram ligados, quantos estão ambíguos e quantos ficaram sem par. Os países da navegação (BR, AR, MX, CO, CL, PE, UY, EC, PY, BO, VE) vêm primeiro, depois as grandes ligas europeias.

Na importação:

- um logo que perdeu o vínculo no manifesto desliga o time;
- um arquivo diferente do manifesto (hash) é ignorado e mantém o vínculo que já existe;
- um alvo que não existe no banco é ignorado.

## Base organizada por país (conversor, layout de 29/10/2026)

O `--converter` detecta sozinho o layout `<País>/<Tipo>/<Nome>/Original/svg|png|webp/` (é o do acervo `galaxie-proprio` desde a revisão `2026-10-29`). O tipo é `Times`, `Seleções`, `Campeonatos` ou `Entidades`, e os arquivos se chamam `[x512 - ]Escudo|Logo - <Nome>.<ext>` (`convert-countries.ts`):

- **Times** viram `teams/<país>/<slug>`, **Seleções** `teams/<país>/selecao-<slug>` (seleção principal do país) e **Campeonatos** `competitions/<país>/<slug>`. `Internacionais` vale como internacional (`WORLD`).
- O nome de exibição é o da pasta. Cada item leva o SVG, o maior PNG e o maior WebP da variante `Original`. As outras variantes (`Escuro`, `Mono`...) vão só para o relatório, até a API publicar variantes.
- Ficam de fora e vão para o relatório: **Entidades** (FIFA, CONMEBOL...), que não têm alvo na base; logos de **edição** ("Eurocopa 1960"), porque o alvo é a competição; e **bandeiras** ("Bandeira - Suíça").
- **Mudança de layout:** a chave nova herda o vínculo e a curadoria da chave antiga pelo tipo e pelo nome (o país tem de bater, ou a chave antiga ser internacional). Os 547 vínculos da revisão `2026-10-23` passam inteiros.
- **Competições:** os nomes de mercado ("Campeonato Brasileiro Série A") ligam pela liga da api-sports em `competition-leagues.ts`, quando a liga existe no banco, é do mesmo país e os nomes têm uma palavra com o mesmo começo. Fora da tabela, casam pelo nome.
- Os times não estão mais em pastas de competição, então casam no país com o limiar alto (0,9). Revise os ambíguos e os sem par na cobertura.

## Base organizada por competição (conversor)

Uma base no formato `<País> - <Competição>/svg|png|webp/Escudo - <Time>.<ext>` (é o caso do acervo `galaxie-proprio`) entra pelo conversor. Ele grava o pacote no layout acima, sem banco e sem rede:

```bash
pnpm --filter @galaxie/ingestor assets:acervo --converter "<origem>" --pasta ../../data/assets/acervo-galaxie-proprio \
  --acervo galaxie-proprio --nome "Acervo próprio Galaxie" --autor "Wagner / Galaxie Works" \
  --licenca "Base própria; uso de marcas de clubes sujeito a licenciamento" --revisao 2026-10-23
```

- **Arquivos:** SVG, o maior PNG e o maior WebP de cada escudo. O SVG é o servido (senão o PNG, senão o WebP), e o PNG também é a fonte da paleta.
- **Seleções e bandeiras:** "Escudo - Seleção - <País>" vira escudo de seleção; "Bandeira - <País>" não é escudo e fica de fora.
- **Entrada não confiável:** o conversor lê só SVG, PNG e WebP, confere a assinatura do PNG e do WebP e o tamanho (até 5 MB) e recusa SVG com conteúdo ativo (`svg-safety.ts`). Nesse caso o escudo cai no PNG. Os arquivos são gravados com nomes saneados, nunca com o nome original.
- **Repetidos:** o mesmo arquivo em mais de uma pasta entra uma vez só, de preferência na pasta da liga nacional.
- **Grupos:** cada pasta vira um grupo no `acervo.yaml`, com o país e as ligas da api-sports dela (`FOLDER_LEAGUES` em `convert-folders.ts`). O mapeamento usa esse grupo.

Com grupos, o mapeamento segue três caminhos, do mais forte para o mais fraco:

1. **Seleção:** o país do nome ("Seleção - País de Gales") aponta a seleção principal daquele país, a que tem o nome do país. Base, feminino e clube cadastrado como seleção ficam de fora.
2. **Competição:** casa entre os times que têm jogos nas ligas do grupo. É uma lista fechada, então aceita nome traduzido ("Bayern de Munique" × "Bayern München") quando o vencedor fica bem à frente do segundo: confiança ≥ 0,8 com folga 0,1, ou ≥ 0,6 com folga 0,25 e uma palavra com o mesmo começo. Isso impede "Konyaspor" × "Alanyaspor".
3. **País:** se o time não está na competição (subiu de divisão, ou o banco ainda não tem a temporada), casa no país com o limiar alto (0,9).

Quando dois logos caem no mesmo time:

- o da liga nacional vence o do torneio internacional, e o outro fica `duplicate`;
- se um vence com folga de 0,1 (por exemplo "Independiente" × "Independiente Rivadavia"), fica ele;
- senão, os dois vão para a curadoria.

## Reabastecer (novos escudos na pasta)

A pasta de origem pode crescer e mudar à vontade: o fluxo inteiro é idempotente.

1. Pasta nova de competição: inclua a linha dela em `FOLDER_LEAGUES` (`convert-folders.ts`) com as ligas da api-sports, senão ela casa só pelo país.
2. Rode o `--converter` de novo, com a `--revisao` do dia. O pacote anterior é refeito do zero.
3. Rode o `--mapear` contra o manifesto versionado: os vínculos `manual` e `rejected` ficam, os logos novos entram, e os que saíram da pasta somem do manifesto (o time volta ao logo do fornecedor na importação).
4. Revise o relatório `<id>.cobertura.md` e os ambíguos, versione o manifesto e importe. Logo que não mudou não é regravado, e um asset importado antes da `0062` ganha os formatos na primeira reimportação.

## Produção (VPS)

O contêiner do ingestor roda como `node`, com o repositório em `/srv`, o que inclui o `config` versionado em `/srv/config`. O manifesto e o relatório da produção vão para `/tmp` do contêiner, partindo da cópia versionada, para manter a curadoria (`rejected`/`manual`). Depois do deploy com a migration `0023`:

```bash
# 1. no computador com a base: gerar o pacote (ou reaproveitar o gerado no dev)
pnpm --filter @galaxie/ingestor assets:acervo --converter "C:\Users\consa\Downloads\Escudos" \
  --pasta ../../data/assets/acervo-galaxie-proprio --acervo galaxie-proprio --nome "Acervo próprio Galaxie" \
  --autor "Wagner / Galaxie Works" --licenca "Base própria; uso de marcas de clubes sujeito a licenciamento" --revisao 2026-10-29
tar -C data/assets -czf acervo-galaxie-proprio.tgz acervo-galaxie-proprio
scp acervo-galaxie-proprio.tgz <vps>:/tmp/

# 2. na VPS, no diretório do compose (fora do repositório)
mkdir -p /tmp/acervo && tar -C /tmp/acervo -xzf /tmp/acervo-galaxie-proprio.tgz
docker compose cp /tmp/acervo/acervo-galaxie-proprio ingestor:/tmp/acervo-galaxie-proprio
docker compose exec -T ingestor cp /srv/config/assets/acervo/galaxie-proprio.yaml /tmp/galaxie-proprio.yaml
docker compose exec -T ingestor node dist/cli/assets-acervo.js --acervo exemplo --desvincular        # tira o acervo de exemplo
docker compose exec -T ingestor node dist/cli/assets-acervo.js --pasta /tmp/acervo-galaxie-proprio --manifesto /tmp/galaxie-proprio.yaml --mapear
docker compose exec -T ingestor node dist/cli/assets-acervo.js --pasta /tmp/acervo-galaxie-proprio --manifesto /tmp/galaxie-proprio.yaml --plan
docker compose exec -T ingestor node dist/cli/assets-acervo.js --pasta /tmp/acervo-galaxie-proprio --manifesto /tmp/galaxie-proprio.yaml
docker compose cp ingestor:/tmp/galaxie-proprio.cobertura.md ./galaxie-proprio.cobertura.producao.md
```

- O `--mapear` da produção casa contra o banco de produção, porque os ids diferem dos do dev. Ele mantém as decisões de curadoria do manifesto versionado. Uma segunda importação não regrava nada.
- A flag `ASSETS_CUSTOM_LOGOS` continua desligada: com ela desligada, a API fica exatamente como antes. Quem liga é a operação, no painel, quando houver licença para as marcas. Para voltar, desligue: vale em até 15 s.

## Acervo de exemplo

`services/ingestor/test/fixtures/acervo-exemplo/` tem escudos genéricos gerados pela Galaxie (forma de escudo, faixa e iniciais), sem imagens de terceiros. Ele serve para testes e para demonstrar o fluxo ponta a ponta:

- ambíguo: o "América" brasileiro;
- sem par: um clube fictício;
- uma competição.

Não use em produção. No dev (NAS) ele foi importado com `assets:acervo --pasta test/fixtures/acervo-exemplo`, rodado de `services/ingestor`.

## Créditos e licenças dos acervos

| Acervo | Autor | Licença | Situação |
| --- | --- | --- | --- |
| `exemplo` | Galaxie Works | Próprio (gerado para testes e demonstração) | Só dev e testes; desvincular na produção |
| `galaxie-proprio` | Wagner / Galaxie Works | Base própria; uso de marcas de clubes sujeito a licenciamento | Importado com a flag desligada até haver licença |

Todo acervo importado entra nesta tabela com o autor e a licença do `acervo.yaml`.

**Fonte avaliada e não importada (23/10/2026):** o football-logos.cc, de Leo4815162342, que restaura e vetoriza os logos. O repositório no GitHub só publica colagens de prévia; os arquivos individuais ficam no CDN do site. A página de termos do site proíbe o uso em produtos comerciais e em material de marca ou promocional. Por isso nada foi baixado.
