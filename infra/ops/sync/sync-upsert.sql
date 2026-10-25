-- Sincroniza dados de jogos do NAS (schemas sync_core / sync_multisport) para core / multisport da produção.
-- Atualiza sem apagar: UPDATE por PK (só quando o NAS é mais novo, se houver updated_at) e INSERT do que falta
-- com ON CONFLICT DO NOTHING (qualquer chave única). Colunas: só as que existem nos dois lados.

CREATE OR REPLACE FUNCTION pg_temp.sync_table(src_schema text, dst_schema text, tbl text, dry boolean)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  cols text; src_cols text; set_cols text; pk_cols text; pk_join text; has_updated boolean;
  n_src bigint; n_upd bigint := 0; n_ins bigint := 0; n_match bigint;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg(CASE WHEN c.data_type IN ('USER-DEFINED','ARRAY')
                         THEN format('s.%I::text::%s', c.column_name, (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                                WHERE a.attrelid = format('%I.%I', dst_schema, tbl)::regclass AND a.attname = c.column_name))
                         ELSE format('s.%I', c.column_name) END, ', ' ORDER BY c.ordinal_position)
    INTO cols, src_cols
    FROM information_schema.columns c
    JOIN information_schema.columns s
      ON s.table_schema = src_schema AND s.table_name = tbl AND s.column_name = c.column_name
   WHERE c.table_schema = dst_schema AND c.table_name = tbl
     AND c.is_generated = 'NEVER';
  IF cols IS NULL THEN RETURN format('%s: sem colunas em comum (pulado)', tbl); END IF;

  SELECT string_agg(quote_ident(a.attname), ', '), string_agg(format('t.%1$I = s.%1$I', a.attname), ' AND ')
    INTO pk_cols, pk_join
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = format('%I.%I', dst_schema, tbl)::regclass AND i.indisprimary;
  IF pk_cols IS NULL THEN RETURN format('%s: sem chave primária (pulado)', tbl); END IF;

  -- curadoria (times, competições, estádios): a produção prevalece e o NAS só preenche o vazio;
  -- pessoas: o NAS prevalece (perfis completos) e a produção preenche o vazio; o resto: a versão mais nova
  SELECT string_agg(format(CASE
           WHEN dst_schema = 'core' AND tbl IN ('participant','competition','venue') THEN '%1$I = coalesce(t.%1$I, %2$s)'
           WHEN dst_schema = 'core' AND tbl = 'person' THEN '%1$I = coalesce(%2$s, t.%1$I)'
           ELSE '%1$I = %2$s' END,
           c.column_name,
           CASE WHEN c.data_type IN ('USER-DEFINED','ARRAY')
                THEN format('s.%I::text::%s', c.column_name, (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                         WHERE a.attrelid = format('%I.%I', dst_schema, tbl)::regclass AND a.attname = c.column_name))
                ELSE format('s.%I', c.column_name) END), ', ')
    INTO set_cols
    FROM information_schema.columns c
    JOIN information_schema.columns s
      ON s.table_schema = src_schema AND s.table_name = tbl AND s.column_name = c.column_name
   WHERE c.table_schema = dst_schema AND c.table_name = tbl AND c.is_generated = 'NEVER'
     AND c.column_name NOT IN (SELECT a.attname FROM pg_index i JOIN pg_attribute a
                                ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                               WHERE i.indrelid = format('%I.%I', dst_schema, tbl)::regclass AND i.indisprimary);

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = dst_schema AND table_name = tbl AND column_name = 'updated_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = src_schema AND table_name = tbl AND column_name = 'updated_at')
    INTO has_updated;

  EXECUTE format('SELECT count(*) FROM %I.%I', src_schema, tbl) INTO n_src;
  EXECUTE format('SELECT count(*) FROM %I.%I s JOIN %I.%I t ON %s', src_schema, tbl, dst_schema, tbl, pk_join) INTO n_match;

  IF NOT dry THEN
    -- sem updated_at não dá para saber quem é mais novo: a produção (ao vivo) prevalece, só entra o que falta
    IF set_cols IS NOT NULL AND has_updated THEN
      -- jogo: o relógio do NAS (status 'temporal', sem placar) nunca cobre um resultado do fornecedor
      EXECUTE format('UPDATE %I.%I t SET %s FROM %I.%I s WHERE %s AND s.updated_at > t.updated_at%s',
        dst_schema, tbl, set_cols, src_schema, tbl, pk_join,
        CASE WHEN dst_schema = 'core' AND tbl = 'event' THEN
          ' AND NOT (s.status_source::text = ''temporal'' AND t.status_source::text <> ''temporal'')'
          || ' AND NOT (s.score->>''home'' IS NULL AND t.score->>''home'' IS NOT NULL)' ELSE '' END);
      GET DIAGNOSTICS n_upd = ROW_COUNT;
    END IF;
    EXECUTE format('INSERT INTO %I.%I (%s) SELECT %s FROM %I.%I s ON CONFLICT DO NOTHING',
      dst_schema, tbl, cols, src_cols, src_schema, tbl);
    GET DIAGNOSTICS n_ins = ROW_COUNT;
  END IF;

  RETURN format('%s: nas=%s · ja_existiam=%s · atualizados=%s · inseridos=%s · pulados=%s',
    tbl, n_src, n_match, n_upd, n_ins,
    CASE WHEN dry THEN '?' ELSE (n_src - n_match - n_ins)::text END);
END $$;
