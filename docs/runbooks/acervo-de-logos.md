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
| Contrato | `logo_source` (`provider` \| `acervo` \| `null`) em `Team` (`/v1/teams/{id}`) e `Competition` (`/v1/competitions/{id}`) |
| Cores do time | Saem do escudo efetivo. A paleta do logo do acervo é calculada na importação: do maior PNG do pacote quando há, senão das cores de preenchimento do SVG (`svg-palette.ts`) |
| "Sem logo" (#178) | Time cujo logo do fornecedor era genérico e foi desligado (`logo_asset_id` nulo) ganha o do acervo com a flag ligada: o `coalesce` preenche o buraco |

## Pacote (fora do git)

Os binários nunca entram no repositório. A pasta do pacote segue este layout:

```
<pasta>/acervo.yaml                         id, nome, autor, licença, revisão (+ nomes opcionais)
<pasta>/teams/<país>/<slug>.svg|png         clubes e seleções
<pasta>/competitions/<país|world>/<slug>.svg|png
```

- `<país>` é o código (`br`, `gb-eng`) ou o nome (`brazil`, `england`). `world` vale para torneios internacionais.
- Variantes do mesmo logo (`x.svg`, `x.png`, `x@4x.png`) viram um item só. O SVG é o servido, ou o maior PNG quando não há SVG. A paleta sai do maior PNG.
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
| `rejected` | Curadoria: não tem par. A próxima varredura mantém |

`config/assets/acervo/<id>.cobertura.md` traz, por país, quantos logos foram ligados, quantos estão ambíguos e quantos ficaram sem par. Os países da navegação (BR, AR, MX, CO, CL, PE, UY, EC, PY, BO, VE) vêm primeiro, depois as grandes ligas europeias.

Na importação:

- um logo que perdeu o vínculo no manifesto desliga o time;
- um arquivo diferente do manifesto (hash) é ignorado e mantém o vínculo que já existe;
- um alvo que não existe no banco é ignorado.

## Produção (VPS)

Depois do deploy com a migration `0023`, copie o pacote para a VPS, fora do repositório, e rode no contêiner do ingestor:

```bash
docker compose exec -T ingestor node dist/cli/assets-acervo.js --pasta /caminho/do/pacote --plan
docker compose exec -T ingestor node dist/cli/assets-acervo.js --pasta /caminho/do/pacote
```

- O manifesto versionado tem os `target_id` do banco onde foi gerado. Em outro banco, os alvos que não existirem são ignorados.
- Para mapear contra o banco de produção, rode `--mapear` lá e traga o manifesto e o relatório gerados para o repositório.
- Depois, ligue a flag no painel. Para voltar, desligue: vale em até 15 s.

## Acervo de exemplo

`services/ingestor/test/fixtures/acervo-exemplo/` tem escudos genéricos gerados pela Galaxie (forma de escudo, faixa e iniciais), sem imagens de terceiros. Ele serve para testes e para demonstrar o fluxo ponta a ponta:

- ambíguo: o "América" brasileiro;
- sem par: um clube fictício;
- uma competição.

Não use em produção. No dev (NAS) ele foi importado com `assets:acervo --pasta test/fixtures/acervo-exemplo`, rodado de `services/ingestor`.

## Créditos e licenças dos acervos

| Acervo | Autor | Licença | Situação |
| --- | --- | --- | --- |
| `exemplo` | Galaxie Works | Próprio (gerado para testes e demonstração) | Só dev e testes |

Todo acervo importado entra nesta tabela com o autor e a licença do `acervo.yaml`.

**Fonte avaliada e não importada (23/10/2026):** o football-logos.cc, de Leo4815162342, que restaura e vetoriza os logos. O repositório no GitHub só publica colagens de prévia; os arquivos individuais ficam no CDN do site. A página de termos do site proíbe o uso em produtos comerciais e em material de marca ou promocional. Por isso nada foi baixado.
