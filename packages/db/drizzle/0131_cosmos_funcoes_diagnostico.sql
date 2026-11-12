-- Funções da Cosmos de ajuda de integração (#1007): diagnóstico de chaves e de webhooks e relatório de uso do mês.
-- Já ativas, com o mínimo aprovado; se a função já foi cadastrada pela tela Funções, fica como está.
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES
  ('key.diagnose', 5, 'settings.manage', '/cliente/chaves', true),
  ('webhook.diagnose', 5, 'settings.manage', '/cliente/webhooks', true),
  ('usage.report', 15, 'settings.manage', '/cliente', true)
ON CONFLICT ("name") DO NOTHING;
