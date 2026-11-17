# Catálogo de Conquistas, Cartas e cosméticos (Gamificação, #904)

Conteúdo do módulo de Gamificação: as Conquistas por esporte e as comuns, os Degraus, as Cartas, as Coleções, os cosméticos do Perfil público e o guia de arte. É o entregável da missão de 16/11/2026 (prompt de catálogo), produzido no repositório para revisão antes de virar seed do `game.catalog_achievement`.

| Pasta ou arquivo | O que é |
| --- | --- |
| [regras/linguagem.md](regras/linguagem.md) | A linguagem de regras: o que o motor lê hoje e a extensão proposta (`moment`, `where`, `count`), com [JSON Schema](regras/regra.schema.json) |
| [regras/contrato-dados.md](regras/contrato-dados.md) | Os caminhos de dado que o motor pode ler; só eles valem em `requires_data` |
| [padronizacao.md](padronizacao.md) | Ids, tom de voz, Degraus, bônus, raridade, arte e o checklist das regras fixas |
| [calendario.md](calendario.md) | Jogos por temporada das competições principais de cada esporte e os Degraus resultantes |
| `pesquisa/<esporte>.md` | A pesquisa: os momentos que o torcedor reconhece, a frequência real com fonte, e se o dado detecta (material de trabalho; aqui pode citar casos reais) |
| [pesquisa/consolidado.md](pesquisa/consolidado.md) | As perguntas para o dono deduplicadas, as extensões de linguagem pedidas, as exceções à régua de raridade e o que não coube |
| `conquistas/<esporte>.json`, `conquistas/common.json` | As Conquistas, no formato de importação |
| `cartas/<esporte>.json`, `cartas/common.json`, `cartas/colecoes.json` | As Cartas (uma por Degrau) e as Coleções |
| [arte/guia.md](arte/guia.md) | O sistema visual: estilos, molduras por raridade, tipografia, composição |
| `cosmeticos/*.json` | Níveis, molduras de avatar, planos de fundo e títulos do Perfil público ([regras da vitrine](cosmeticos/README.md)) |
| [RESUMO.md](RESUMO.md) | Números finais, decisões tomadas e perguntas para o dono |
| [_validar.mjs](_validar.mjs) | `node docs/gamificacao/catalogo/_validar.mjs [esporte]`: valida formato, ids, Degraus, bônus, raridade, contrato de dados e termos proibidos |

Nada daqui entra no banco por si: a importação mapeia cada `requires_data` para a base e confere as regras contra jogos reais antes do seed.
