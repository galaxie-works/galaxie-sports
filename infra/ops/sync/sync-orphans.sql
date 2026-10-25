-- Linhas que violam FKs depois do upsert com session_replication_role=replica (FKs não checadas na carga).
CREATE OR REPLACE FUNCTION pg_temp.orphans() RETURNS TABLE(fk text, n bigint) LANGUAGE plpgsql AS $$
DECLARE r record; q text;
BEGIN
  FOR r IN
    SELECT k.conname, cn.nspname cs, c.relname ct, pn.nspname ps, p.relname pt,
           (SELECT string_agg(format('c.%I', a.attname), ',' ORDER BY x.o) FROM unnest(k.conkey) WITH ORDINALITY x(n,o)
              JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.n) ccols,
           (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ') FROM unnest(k.conkey) x(n)
              JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.n) AS nn,
           (SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ')
              FROM unnest(k.confkey, k.conkey) z(pn_, cn_)
              JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = z.pn_
              JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = z.cn_) joincond
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
      JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = p.relnamespace
     WHERE k.contype = 'f' AND cn.nspname IN ('core','multisport')
  LOOP
    q := format('SELECT count(*) FROM %I.%I c WHERE %s AND NOT EXISTS (SELECT 1 FROM %I.%I p WHERE %s)',
                r.cs, r.ct, r.nn, r.ps, r.pt, r.joincond);
    fk := r.cs || '.' || r.ct || ' -> ' || r.pt || ' (' || r.conname || ')';
    EXECUTE q INTO n;
    IF n > 0 THEN RETURN NEXT; END IF;
  END LOOP;
END $$;
SELECT * FROM pg_temp.orphans();
