-- Reaponta para os ids da produção as entidades que o NAS criou com outro uuid (mesmo id do fornecedor ou
-- mesma chave natural). Sem isso, o upsert criaria duplicatas (time/jogo repetido) e órfãos.
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS sync_core.id_remap (old uuid PRIMARY KEY, new uuid NOT NULL, via text);

-- 1) staging sem PK/únicas/FKs: o reapontamento pode gerar repetição, que o INSERT ... ON CONFLICT descarta
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT n.nspname, c.relname, k.conname FROM pg_constraint k
             JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('sync_core','sync_multisport') AND c.relname <> 'id_remap'
              AND k.contype IN ('f') LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.nspname, r.relname, r.conname);
  END LOOP;
  FOR r IN SELECT n.nspname, c.relname, k.conname FROM pg_constraint k
             JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('sync_core','sync_multisport') AND c.relname <> 'id_remap'
              AND k.contype IN ('p','u') LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.nspname, r.relname, r.conname);
  END LOOP;
  FOR r IN SELECT schemaname, indexname FROM pg_indexes
            WHERE schemaname IN ('sync_core','sync_multisport') AND tablename <> 'id_remap'
              AND indexdef LIKE 'CREATE UNIQUE%' LOOP
    EXECUTE format('DROP INDEX %I.%I', r.schemaname, r.indexname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.find_remaps() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record; cond text; n bigint := 0; k bigint;
BEGIN
  INSERT INTO sync_core.id_remap
  SELECT DISTINCT ON (s.entity_id) s.entity_id, t.entity_id, 'provider_map'
    FROM sync_core.provider_map s JOIN core.provider_map t
      ON t.provider = s.provider AND t.sport = s.sport AND t.entity_type = s.entity_type AND t.provider_id = s.provider_id
   WHERE t.entity_id <> s.entity_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  -- (NULLS NOT DISTINCT vira coalesce: IS NOT DISTINCT FROM não usa hash join e trava em tabela grande)
  -- chaves naturais: índices únicos simples (sem expressão nem predicado) de tabelas com id uuid
  FOR r IN
    SELECT tn.nspname AS sch, tc.relname AS tbl, ic.relname AS idx, i.indnullsnotdistinct AS nnd,
           array_agg(a.attname ORDER BY x.ord) AS cols
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class tc ON tc.oid = i.indrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY x(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = x.attnum
     WHERE tn.nspname IN ('core','multisport') AND i.indisunique AND NOT i.indisprimary
       AND i.indexprs IS NULL AND i.indpred IS NULL AND tc.relname <> 'provider_map'
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = tn.nspname
                    AND table_name = tc.relname AND column_name = 'id' AND data_type = 'uuid')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sync_' || tn.nspname
                    AND table_name = tc.relname)
     GROUP BY 1, 2, 3, 4
  LOOP
    IF 'id' = ANY (r.cols) THEN CONTINUE; END IF;
    SELECT string_agg(format(CASE WHEN r.nnd THEN 'coalesce(t.%1$I::text, chr(1)) = coalesce(s.%1$I::text, chr(1))' ELSE 't.%1$I::text = s.%1$I::text' END, c), ' AND ')
      INTO cond FROM unnest(r.cols) c;
    EXECUTE format('INSERT INTO sync_core.id_remap SELECT DISTINCT ON (s.id) s.id, t.id, %L FROM sync_%s.%I s JOIN %I.%I t ON %s
                    WHERE s.id <> t.id ON CONFLICT DO NOTHING', r.tbl || ':' || r.idx, r.sch, r.tbl, r.sch, r.tbl, cond);
    GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.apply_remaps() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record; n bigint := 0; k bigint;
BEGIN
  FOR r IN SELECT c.table_schema, c.table_name, c.column_name FROM information_schema.columns c
             JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema IN ('sync_core','sync_multisport') AND c.table_name <> 'id_remap'
              AND c.data_type = 'uuid' AND t.table_type = 'BASE TABLE' LOOP
    EXECUTE format('UPDATE %I.%I x SET %I = m.new FROM sync_core.id_remap m WHERE x.%I = m.old',
                   r.table_schema, r.table_name, r.column_name, r.column_name);
    GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  END LOOP;
  RETURN n;
END $$;

DO $$ DECLARE found bigint; moved bigint; i int := 0; BEGIN
  LOOP
    i := i + 1;
    found := pg_temp.find_remaps();
    moved := pg_temp.apply_remaps();
    RAISE NOTICE 'rodada %: % ids novos reapontados, % referências atualizadas', i, found, moved;
    EXIT WHEN found = 0 OR i >= 6;
  END LOOP;
END $$;
SELECT via, count(*) FROM sync_core.id_remap GROUP BY 1 ORDER BY 2 DESC;
