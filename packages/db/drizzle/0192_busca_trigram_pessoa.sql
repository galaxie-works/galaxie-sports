-- galaxie:concurrently
-- Busca global de pessoas (GET /v1/search): o pré-filtro passa a ser um regex sem acento sobre a expressão imutável
-- abaixo, servida por este índice GIN trigram. Antes era concat_ws (STABLE, não indexável) com os apelidos em
-- jsonpath, e cada busca lia core.person inteira: 23 s em produção com a CPU limitada, contra o statement_timeout
-- de 10 s do perfil api (17/11/2026). A expressão tem de ser idêntica à de personSearchMatchSql
-- (apps/api/src/search/match.ts), com os literais inline, senão o planner não casa o índice.
-- O migrate cria o índice com CREATE INDEX CONCURRENTLY, fora de transação, antes de aplicar este arquivo
-- (packages/db/src/concurrent-indexes.ts); aqui o IF NOT EXISTS vira no-op. O gin_trgm_ops vem da 0191.
CREATE INDEX IF NOT EXISTS "person_search_trgm_idx" ON "core"."person" USING gin ((coalesce("name", '') || ' ' || coalesce("first_name", '') || ' ' || coalesce("last_name", '')) gin_trgm_ops);
