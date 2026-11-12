-- #1104 (épico #1103): regras de idade e de autorização do responsável nas fichas por país, e a ficha DEFAULT.
-- Valores sugeridos pela revisão jurídica, a confirmar com o advogado. Só acrescenta: a ficha que já tem os campos
-- (gravada pelo painel depois do código novo) fica como está; país fora da tabela ganha as regras mais protetivas.
WITH rules (country, rules) AS (VALUES
  ('BR', '{"parentalConsentUnder":16,"guardianLinkRequiredUnder":16,"ageAssuranceMin":{"social":"estimated","restrictedContent":"verified"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('AR', '{"parentalConsentUnder":16,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('MX', '{"parentalConsentUnder":18,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('CO', '{"parentalConsentUnder":18,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":true,"consentRenewalDays":null}'::jsonb),
  ('CL', '{"parentalConsentUnder":14,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('PE', '{"parentalConsentUnder":14,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('LATAM', '{"parentalConsentUnder":18,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":true,"consentRenewalDays":null}'::jsonb),
  ('US', '{"parentalConsentUnder":13,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb),
  ('CA', '{"parentalConsentUnder":14,"guardianLinkRequiredUnder":null,"ageAssuranceMin":{"social":"self","restrictedContent":"self"},"hearMinor":false,"consentRenewalDays":null}'::jsonb)
), merged AS (
  -- a ficha atual vence (campo a campo, também dentro de ageAssuranceMin); país fora da tabela ganha o mais protetivo
  SELECT cp.country,
         COALESCE(r.rules, '{"parentalConsentUnder":18,"guardianLinkRequiredUnder":18,"ageAssuranceMin":{"social":"estimated","restrictedContent":"verified"},"hearMinor":true,"consentRenewalDays":null}'::jsonb) || cp.policy
           || jsonb_build_object('ageAssuranceMin',
                COALESCE(r.rules, '{"parentalConsentUnder":18,"guardianLinkRequiredUnder":18,"ageAssuranceMin":{"social":"estimated","restrictedContent":"verified"},"hearMinor":true,"consentRenewalDays":null}'::jsonb)->'ageAssuranceMin'
                  || COALESCE(cp.policy->'ageAssuranceMin', '{}'::jsonb)) AS policy
    FROM engage.country_policy cp
    LEFT JOIN rules r ON r.country = cp.country
   WHERE NOT (cp.policy ? 'parentalConsentUnder')
), fixed AS (
  -- a autorização nunca fica abaixo da idade para participar (até 18), como no validatePolicy
  SELECT country,
         jsonb_set(policy, '{parentalConsentUnder}', to_jsonb(GREATEST((policy->>'parentalConsentUnder')::int,
           LEAST(18, COALESCE((policy->>'minAgeParticipate')::int, 13))))) AS policy
    FROM merged
), changed AS (
  UPDATE engage.country_policy cp
     SET policy = f.policy,
         version = cp.version + 1,
         updated_by = 'migration',
         updated_at = now()
    FROM fixed f
   WHERE f.country = cp.country
  RETURNING cp.country, cp.version, cp.policy
)
INSERT INTO engage.country_policy_log (country, version, policy, changed_by, reason)
SELECT country, version, policy, 'migration', 'idade e responsável (#1104)' FROM changed;
--> statement-breakpoint
WITH inserted AS (
  INSERT INTO engage.country_policy (country, policy, version, updated_by) VALUES
    ('DEFAULT', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":true,"entity":"llc","currency":"USD","dateFormat":"yyyy-MM-dd","timeZone":"UTC","languages":["en"],"laws":["GDPR (UE) e leis locais de proteção de dados (a confirmar por país)"],"parentalConsentUnder":18,"guardianLinkRequiredUnder":18,"ageAssuranceMin":{"social":"estimated","restrictedContent":"verified"},"hearMinor":true,"consentRenewalDays":null}'::jsonb, 1, 'migration')
  ON CONFLICT (country) DO NOTHING
  RETURNING country, version, policy
)
INSERT INTO engage.country_policy_log (country, version, policy, changed_by, reason)
SELECT country, version, policy, 'migration', 'ficha DEFAULT (#1104)' FROM inserted;
