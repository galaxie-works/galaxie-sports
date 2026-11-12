-- Moderação de imagem da Cosmos (#1025): foto de perfil, foto do mural e imagem de comunidade. Já ativa, com o mínimo
-- por imagem aprovado; se a função já foi cadastrada pela tela Funções, fica como está.
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES ('moderation.image', 2, 'settings.manage', '/cliente/moderacao', true)
ON CONFLICT ("name") DO NOTHING;
