-- #1115 (épico #1017): apostas, consentimento de marketing e guarda legal nas fichas por país. Valores sugeridos pela
-- revisão jurídica de 11/11/2026, com o aval do advogado em 12/11. Só acrescenta: o campo que a ficha já
-- tem (gravado pelo painel depois do código novo) fica como está; país fora da tabela ganha o mais protetivo.
WITH rules (country, rules) AS (VALUES
  ('BR', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('AR', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('MX', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('CO', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('CL', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('PE', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('LATAM', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb),
  ('US', '{"bettingContent":false,"marketingConsent":{"email":"opt-out","push":"opt-in","sms":"opt-in"},"legalHoldDays":365}'::jsonb),
  ('CA', '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":180}'::jsonb)
), base AS (
  SELECT cp.country, cp.policy,
         COALESCE(r.rules, '{"bettingContent":false,"marketingConsent":{"email":"opt-in","push":"opt-in","sms":"opt-in"},"legalHoldDays":365}'::jsonb) AS rules
    FROM engage.country_policy cp
    LEFT JOIN rules r ON r.country = cp.country
   -- null conta como ausente (guarda nula acabaria na hora da denúncia)
   WHERE NOT (jsonb_typeof(cp.policy->'bettingContent') IS DISTINCT FROM 'null'
              AND cp.policy ? 'bettingContent'
              AND jsonb_typeof(cp.policy->'legalHoldDays') IS DISTINCT FROM 'null'
              AND cp.policy ? 'legalHoldDays'
              AND jsonb_typeof(cp.policy->'marketingConsent') = 'object'
              AND jsonb_strip_nulls(cp.policy->'marketingConsent') ?& ARRAY['email', 'push', 'sms'])
), merged AS (
  -- a ficha atual vence, campo a campo (também dentro de marketingConsent), menos onde está null
  SELECT country,
         rules
           || (policy - ARRAY(SELECT k FROM unnest(ARRAY['bettingContent', 'legalHoldDays']) AS k
                               WHERE policy->k = 'null'::jsonb))
           || jsonb_build_object('marketingConsent', (rules->'marketingConsent')
                || CASE jsonb_typeof(policy->'marketingConsent') WHEN 'object'
                     THEN jsonb_strip_nulls(policy->'marketingConsent') ELSE '{}'::jsonb END) AS policy
    FROM base
), changed AS (
  UPDATE engage.country_policy cp
     SET policy = m.policy,
         version = cp.version + 1,
         updated_by = 'migration',
         updated_at = now()
    FROM merged m
   WHERE m.country = cp.country
  RETURNING cp.country, cp.version, cp.policy
)
INSERT INTO engage.country_policy_log (country, version, policy, changed_by, reason)
SELECT country, version, policy, 'migration', 'apostas, marketing e guarda legal (#1115)' FROM changed;
