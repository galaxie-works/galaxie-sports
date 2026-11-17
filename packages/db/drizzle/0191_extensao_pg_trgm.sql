-- pg_trgm para o índice trigram da busca global de pessoas (0192_busca_trigram_pessoa). A busca filtra core.person
-- (630 mil linhas em produção) com regex sem acento; sem índice era um Parallel Seq Scan de 23 s com a CPU limitada,
-- acima do statement_timeout de 10 s do perfil api, e a busca devolvia 500 (17/11/2026). O pg_trgm é extensão
-- trusted (o dono do banco cria sem superusuário) e indexa LIKE/ILIKE/~/~* com GIN.
--
-- Fica numa migration própria porque a 0192 é `-- galaxie:concurrently` (só aceita CREATE INDEX) e o runMigrations
-- aplica as anteriores antes de criar o índice com CONCURRENTLY: o operator class gin_trgm_ops precisa existir
-- antes. Fica no schema public, como a public.uuid_generate_v7 da 0000.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
