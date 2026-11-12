-- #1107 (épico #1103): padrão mais protetivo para os Perfis de menores que já existiam antes dele. Desde o #1107, a
-- gravação do token já zera a foto e a visibilidade do menor; esta migration faz o mesmo nos Perfis que não pediram
-- token desde então, para que a foto própria não fique guardada e uma escolha pública antiga não volte sozinha aos
-- 18 anos. Vale para a faixa de menor e para a faixa congelada (desceu de adulto, #1105). Só dados: não muda tabela.
UPDATE "fan"."profile"
SET "avatar_url" = NULL, "visibility" = '{}'::jsonb, "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND ("age_band" <> '18plus' OR "age_frozen_at" IS NOT NULL)
  AND ("avatar_url" IS NOT NULL OR "visibility" <> '{}'::jsonb);
