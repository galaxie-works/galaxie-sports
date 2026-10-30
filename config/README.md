# config

Configuração de operação versionada em YAML. Muda o comportamento sem mudar código: um PR aqui vai para a VPS no
próximo deploy, porque as imagens copiam esta pasta para `/srv/config`.

| Pasta / arquivo | O que define | Lido por | Variável que troca o caminho |
|---|---|---|---|
| `competitions/<esporte>.yaml` | Catálogo das 12 APIs: IDs verificados, tiers e prioridade (145 competições no futebol) | `services/ingestor` | — (relativo ao pacote) |
| `rules/*.yaml` | Regulamento de cada competição (desempate, zonas, grupos) e `default.yaml` | `@galaxie/rules` | `RULES_CONFIG_DIR` (API: `RULES_DIR`) |
| `broadcasters/*.yaml` | Dicionário de emissoras e plataformas por país, logos e política | `@galaxie/where-to-watch` | `WTW_CONFIG_DIR` |
| `broadcast-rights/*.yaml` | Tabela de direitos por competição e país | `@galaxie/where-to-watch` | `WTW_CONFIG_DIR` |
| `geo/*.yaml` | Confederações, audiência por mercado e escopo das competições por país | `@galaxie/geo` | `GEO_CONFIG_DIR` |
| `plans.yaml` | Modelos de plano comercial usados ao criar um tenant | `apps/api` | `PLANS_CONFIG_PATH` |
| `ai-policy.yaml` | Política de execução da IA: faixas do orçamento diário, prioridades | `@galaxie/ai-ledger` | `AI_POLICY_FILE` |
| `assets/denylist.yaml` | Mídia da api-sports que não pode ser usada | API e ingestor (`assets:mirror`) | API: `MEDIA_DENYLIST_PATH`; ingestor: opção `--denylist` (não lê a variável) |
| `assets/acervo/`, `assets/commons/` | Mapeamento do acervo próprio de escudos e das imagens do Wikimedia Commons | `services/ingestor` (`assets:acervo`, `assets:commons*`) | — |
| `fixtures/provisional.yaml` | Jogos anunciados que o fornecedor ainda não publicou | `services/ingestor` (`provisional:sync`) | `PROVISIONAL_FIXTURES_PATH` |
| `related-content/channels.yaml` | Canais do YouTube permitidos no conteúdo relacionado e o nível de confiança de cada um | `services/ai-agents` | — |

A base semântica (times, clássicos, copy) não está aqui: fica em [`data/knowledge`](../data/knowledge/SCHEMA.md), com
validação própria (`pnpm knowledge:validate`).

Cuidado ao mover arquivos: vários pacotes acham esta pasta por caminho relativo (`../../config`) e as imagens recriam o
mesmo layout em `/srv`. Ver [docs/15 §5, F7](../docs/15-organizacao-do-monorepo.md#5-fronteiras-confusas-hoje).
