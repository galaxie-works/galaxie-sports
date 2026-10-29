-- Quem jogou e quem dirigiu cada partida, fora do JSON do detalhe. O perfil da pessoa (/v1/people/{id}/overview)
-- abria `detail` inteiro de todas as partidas dos times candidatos (1.505 detalhes e ~240 MB de buffers para um
-- jogador do Palmeiras, 4,3 s com o cache frio) para achar as ~360 em que ela aparece; sob o pós-deploy, passou dos
-- 10 s do statement_timeout da API (29/10). Com os IDs aqui, a consulta filtra antes de abrir o detalhe.
-- O trigger mantém as colunas em toda escrita do detalhe (todos os writers); as linhas antigas ficam nulas até o
-- job fixture-people preenchê-las em lotes (nulo = "pode ter": a consulta abre o detalhe como antes). Colunas novas
-- sem default: o ALTER não reescreve a tabela.
ALTER TABLE "core"."football_fixture" ADD COLUMN "player_pids" integer[];--> statement-breakpoint
ALTER TABLE "core"."football_fixture" ADD COLUMN "coach_pids" integer[];--> statement-breakpoint
CREATE OR REPLACE FUNCTION core.fixture_player_pids(detail jsonb) RETURNS integer[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT (p->'player'->>'id')::integer), '{}')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(detail->'players') = 'array'
                                   THEN detail->'players' ELSE '[]'::jsonb END) t
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t->'players') = 'array'
                                                THEN t->'players' ELSE '[]'::jsonb END) p
   WHERE p->'player'->>'id' ~ '^[0-9]{1,9}$'
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION core.fixture_coach_pids(detail jsonb) RETURNS integer[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT (l->'coach'->>'id')::integer), '{}')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(detail->'lineups') = 'array'
                                   THEN detail->'lineups' ELSE '[]'::jsonb END) l
   WHERE l->'coach'->>'id' ~ '^[0-9]{1,9}$'
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION core.football_fixture_people() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.player_pids := core.fixture_player_pids(NEW.detail);
  NEW.coach_pids := core.fixture_coach_pids(NEW.detail);
  RETURN NEW;
END
$$;--> statement-breakpoint
-- UPDATE OF detail: o upsert do ingestor sempre põe o detalhe no SET (e só grava quando algo mudou); o
-- preenchimento do job não mexe no detalhe e não dispara o trigger
CREATE TRIGGER football_fixture_people
BEFORE INSERT OR UPDATE OF detail ON core.football_fixture
FOR EACH ROW EXECUTE FUNCTION core.football_fixture_people();
