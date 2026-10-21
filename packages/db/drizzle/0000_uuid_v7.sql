-- UUID v7 (RFC 9562) para PKs próprias: ordenável por tempo, sem extensões.
-- PostgreSQL 17 não tem uuidv7() nativo (chega no 18); quando migrarmos, esta função pode delegar a ele.
CREATE OR REPLACE FUNCTION public.uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE AS $$
DECLARE
  ts_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  buf bytea;
BEGIN
  buf := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || substring(uuid_send(gen_random_uuid()) FROM 7 FOR 10);
  buf := set_byte(buf, 6, (get_byte(buf, 6) & 15) | 112);  -- versão 7
  buf := set_byte(buf, 8, (get_byte(buf, 8) & 63) | 128);  -- variante RFC 4122
  RETURN encode(buf, 'hex')::uuid;
END
$$;
