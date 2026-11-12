-- Funções da Cosmos no Builder (#1005): widget a partir de uma frase e passos de instalação. Já ativas, com o mínimo
-- aprovado; se a função já foi cadastrada pela tela Funções, fica como está.
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES
  ('widget.compose', 10, 'settings.manage', '/cliente/builder', true),
  ('widget.install', 5, 'settings.manage', '/cliente/builder', true)
ON CONFLICT ("name") DO NOTHING;
